const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const { onDocumentCreated, onDocumentUpdated } = require('firebase-functions/v2/firestore');
const admin = require('firebase-admin');
const crypto = require('crypto');

admin.initializeApp();

// ============================================================
// HELPERS
// ============================================================

function distanceKmBetween(a, b) {
  if (!a || !b || typeof a.lat !== 'number' || typeof a.lng !== 'number' || typeof b.lat !== 'number' || typeof b.lng !== 'number') {
    return null;
  }
  const toRad = (v) => (v * Math.PI) / 180;
  const r = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return Math.max(1, Math.round(r * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x)) * 10) / 10);
}

// ============================================================
// quoteFare — fare quote for customer
// ============================================================

exports.quoteFare = onCall({ region: 'asia-south1' }, async (request) => {
  const data = request.data || {};

  const vehicleId = data.vehicleType || data.vehicleId;
  const service = data.serviceType || data.service;
  const pickup = data.pickup
    || (typeof data.pickupLat === 'number' ? { lat: data.pickupLat, lng: data.pickupLng } : null);
  const drop = data.drop
    || (typeof data.dropLat === 'number' ? { lat: data.dropLat, lng: data.dropLng } : null);

  if (!vehicleId || !service || !pickup || !drop) {
    throw new HttpsError(
      'invalid-argument',
      `Missing fields. Got vehicleId=${vehicleId}, service=${service}, pickup=${!!pickup}, drop=${!!drop}`
    );
  }

  const distanceKm = distanceKmBetween(pickup, drop);
  if (distanceKm == null) {
    throw new HttpsError('invalid-argument', 'Invalid pickup/drop coordinates');
  }

  const settingsSnap = await admin.firestore().doc('settings/app').get();
  const settings = settingsSnap.exists ? settingsSnap.data() : {};

  const list = service === 'ride'
    ? (settings.rideVehicles || [])
    : (settings.parcelVehicles || []);
  const vehicle = list.find((v) => v.id === vehicleId);
  if (!vehicle) {
    throw new HttpsError('not-found', `Vehicle ${vehicleId} not found in ${service} list`);
  }

  const baseFare = Number(vehicle.baseFare) || 0;
  const perKm = Number(vehicle.perKm) || 0;
  const distanceFare = Math.round(distanceKm * perKm);
  const tripFare = baseFare + distanceFare;

  const searchRadiusKm = Number(settings.searchRadiusKm) || 5;
  const pickupFreeKm = Number(vehicle.pickupFreeKm) || 2;
  const pickupKmRate = Number(vehicle.pickupKmRate) || 0;
  const billablePickupKm = Math.max(0, searchRadiusKm - pickupFreeKm);
  const maxPickupPremium = Math.round(billablePickupKm * pickupKmRate);

  const totalInPaise = (tripFare + maxPickupPremium) * 100;

  const commissionPct = Number(vehicle.commission) || Number(settings.commissionPct) || 20;
  const commissionAmount = Math.round(totalInPaise * commissionPct / 100);

  return {
    distanceKm,
    fare: {
      baseFare: baseFare * 100,
      distanceFare: distanceFare * 100,
      pickupPremium: maxPickupPremium * 100,
      totalInPaise,
    },
    fareRange: {
      minInPaise: tripFare * 100,
      maxInPaise: (tripFare + maxPickupPremium) * 100,
    },
    commission: {
      pct: commissionPct,
      amountInPaise: commissionAmount,
    },
    etaRange: {
      minMinutes: Math.max(2, Math.round((distanceKm / 25) * 60)),
      maxMinutes: Math.max(5, Math.round(((distanceKm + searchRadiusKm) / 25) * 60)),
    },
    pickupEtaRange: {
      minMinutes: 2,
      maxMinutes: Math.max(5, Math.round((searchRadiusKm / 25) * 60)),
    },
    pickupConfig: {
      freeKm: pickupFreeKm,
      ratePerKm: pickupKmRate,
      searchRadiusKm,
    },
  };
});

// ============================================================
// RAZORPAY FUNCTIONS
// ============================================================

// 1. CREATE ORDER
exports.createRazorpayOrder = onCall({ region: 'asia-south1' }, async (request) => {
  const { amount, bookingId, currency = 'INR' } = request.data || {};
  if (!request.auth) throw new HttpsError('unauthenticated', 'Login required');
  if (!amount || !bookingId) throw new HttpsError('invalid-argument', 'amount and bookingId required');

  let Razorpay;
  try { Razorpay = require('razorpay'); }
  catch (e) { throw new HttpsError('failed-precondition', 'razorpay package not installed in functions/'); }

  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) {
    throw new HttpsError('failed-precondition', 'Razorpay keys not configured');
  }

  const bookingDoc = await admin.firestore().doc(`bookings/${bookingId}`).get();
  if (!bookingDoc.exists) throw new HttpsError('not-found', 'Booking not found');
  const booking = bookingDoc.data();
  if (booking.customerId !== request.auth.uid) {
    throw new HttpsError('permission-denied', 'Not your booking');
  }

  const razorpay = new Razorpay({ key_id: keyId, key_secret: keySecret });
  try {
    const order = await razorpay.orders.create({
      amount,
      currency,
      receipt: `bk_${bookingId.substring(0, 30)}`,
      notes: { bookingId, customerId: request.auth.uid },
    });

    await admin.firestore().doc(`bookings/${bookingId}`).update({
      'razorpay.orderId': order.id,
      'razorpay.amount': amount,
      'razorpay.createdAt': admin.firestore.FieldValue.serverTimestamp(),
    });

    return { orderId: order.id, amount: order.amount, currency: order.currency, keyId };
  } catch (err) {
    throw new HttpsError('internal', `Razorpay order create failed: ${err.message}`);
  }
});

// 2. VERIFY PAYMENT
exports.verifyRazorpayPayment = onCall({ region: 'asia-south1' }, async (request) => {
  const {
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature,
    bookingId,
  } = request.data || {};

  if (!request.auth) throw new HttpsError('unauthenticated', 'Login required');
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !bookingId) {
    throw new HttpsError('invalid-argument', 'Missing fields');
  }

  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keySecret) throw new HttpsError('failed-precondition', 'Razorpay key not set');

  const expected = crypto
    .createHmac('sha256', keySecret)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest('hex');
  if (expected !== razorpay_signature) {
    throw new HttpsError('permission-denied', 'Signature mismatch');
  }

  await admin.firestore().doc(`bookings/${bookingId}`).update({
    paymentStatus: 'driver_confirmed',
    'razorpay.paymentId': razorpay_payment_id,
    'razorpay.signature': razorpay_signature,
    'razorpay.verifiedAt': admin.firestore.FieldValue.serverTimestamp(),
    'commission.status': 'collected',
    paidAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { success: true, paymentId: razorpay_payment_id };
});

// 3. WEBHOOK
exports.razorpayWebhook = onRequest({ region: 'asia-south1' }, async (req, res) => {
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!webhookSecret) { res.status(500).send('Webhook secret not configured'); return; }

  const signature = req.headers['x-razorpay-signature'];
  if (!signature) { res.status(400).send('Missing signature'); return; }

  const expected = crypto
    .createHmac('sha256', webhookSecret)
    .update(JSON.stringify(req.body))
    .digest('hex');
  if (expected !== signature) { res.status(401).send('Invalid signature'); return; }

  const event = req.body.event;
  const payment = req.body.payload && req.body.payload.payment && req.body.payload.payment.entity;

  if (event === 'payment.captured' && payment) {
    const bookingId = payment.notes && payment.notes.bookingId;
    if (bookingId) {
      try {
        await admin.firestore().doc(`bookings/${bookingId}`).update({
          paymentStatus: 'driver_confirmed',
          'razorpay.paymentId': payment.id,
          'razorpay.captured': true,
          'razorpay.capturedAt': admin.firestore.FieldValue.serverTimestamp(),
          'commission.status': 'collected',
          paidAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      } catch (e) {
        console.error('Webhook update failed:', e);
        res.status(500).send('Update failed');
        return;
      }
    }
  }

  res.status(200).send('OK');
});

// ============================================================
// PUSH NOTIFICATIONS
// ============================================================
// Setup: cd functions && npm install expo-server-sdk
// ============================================================

const { Expo } = require('expo-server-sdk');
const expo = new Expo();

/**
 * Notify online drivers when a new booking is created
 */
exports.notifyDriversOnNewBooking = onDocumentCreated(
  { document: 'bookings/{bookingId}', region: 'asia-south1' },
  async (event) => {
    const booking = event.data.data();
    const bookingId = event.params.bookingId;

    if (booking.status !== 'searching') return;

    const vehicleType = booking.vehicleType;
    const pickupAddr = booking.pickup?.address || 'Nearby';
    const dropAddr = booking.drop?.address || '';
    const fare = booking.fare?.totalInPaise
      ? `₹${Math.round(booking.fare.totalInPaise / 100)}`
      : '';

    console.log(`[Notify] New booking ${bookingId} for ${vehicleType}`);

    const driversSnap = await admin.firestore()
      .collection('drivers')
      .where('status', '==', 'online')
      .where('vehicle.type', '==', vehicleType)
      .get();

    if (driversSnap.empty) {
      console.log(`[Notify] No online drivers for ${vehicleType}`);
      return;
    }

    const messages = [];
    driversSnap.forEach((driverDoc) => {
      const driver = driverDoc.data();
      const token = driver.expoPushToken;
      if (token && Expo.isExpoPushToken(token)) {
        messages.push({
          to: token,
          sound: 'default',
          title: '🚚 New Trip Request!',
          body: `${pickupAddr}${dropAddr ? ' → ' + dropAddr : ''} ${fare}`.trim(),
          data: { type: 'new_booking', bookingId, vehicleType },
          channelId: 'bookings',
          priority: 'high',
          badge: 1,
        });
      }
    });

    if (messages.length === 0) return;

    console.log(`[Notify] Sending to ${messages.length} drivers`);
    const chunks = expo.chunkPushNotifications(messages);
    for (const chunk of chunks) {
      try { await expo.sendPushNotificationsAsync(chunk); }
      catch (err) { console.error('[Notify] Send error:', err); }
    }
  }
);

/**
 * Notify customer when booking status changes
 */
exports.notifyCustomerOnBookingUpdate = onDocumentUpdated(
  { document: 'bookings/{bookingId}', region: 'asia-south1' },
  async (event) => {
    const before = event.data.before.data();
    const after = event.data.after.data();
    const bookingId = event.params.bookingId;

    if (before.status === after.status) return;

    const customerId = after.customerId;
    if (!customerId) return;

    const customerDoc = await admin.firestore().collection('users').doc(customerId).get();
    if (!customerDoc.exists) return;

    const token = customerDoc.data().expoPushToken;
    if (!token || !Expo.isExpoPushToken(token)) return;

    let title, body;
    switch (after.status) {
      case 'accepted':
        title = '✅ Driver Found!';
        body = `${after.driverName || 'Your driver'} is on the way to pick up`;
        break;
      case 'arrived':
        title = '📍 Driver Arrived!';
        body = `${after.driverName || 'Your driver'} has arrived at pickup point`;
        break;
      case 'picked_up':
        title = '🚚 On The Way!';
        body = 'Your delivery is in progress';
        break;
      case 'reached_dropoff':
      case 'reached':
        title = '📦 Almost There!';
        body = 'Driver has reached the drop location';
        break;
      case 'awaiting_payment':
        title = '💳 Payment Required';
        body = `Please confirm your payment of ₹${Math.round((after.fare?.totalInPaise || 0) / 100)}`;
        break;
      case 'completed':
        title = '✅ Trip Complete!';
        body = `Your trip is complete. Total: ₹${Math.round((after.fare?.totalInPaise || 0) / 100)}`;
        break;
      case 'cancelled':
        title = '❌ Booking Cancelled';
        body = after.cancelReason || 'Your booking has been cancelled';
        break;
      default:
        return;
    }

    try {
      await expo.sendPushNotificationsAsync([{
        to: token,
        sound: 'default',
        title,
        body,
        data: { type: 'booking_update', bookingId, status: after.status },
        channelId: 'general',
        priority: 'high',
      }]);
      console.log(`[Notify] Customer notified: ${after.status}`);
    } catch (e) {
      console.error('[Notify] Customer notification error:', e);
    }
  }
);

/**
 * SOS Alert handler — notify driver if booking exists
 */
exports.handleSOS = onDocumentCreated(
  { document: 'sos/{sosId}', region: 'asia-south1' },
  async (event) => {
    const sos = event.data.data();
    const sosId = event.params.sosId;

    console.log(`[SOS] Alert from ${sos.customerName}: type=${sos.type}`);

    if (sos.bookingId) {
      try {
        const bookingSnap = await admin.firestore().doc(`bookings/${sos.bookingId}`).get();
        if (bookingSnap.exists) {
          const booking = bookingSnap.data();
          if (booking.driverId) {
            const driverSnap = await admin.firestore().doc(`drivers/${booking.driverId}`).get();
            if (driverSnap.exists) {
              const token = driverSnap.data().expoPushToken;
              if (token && Expo.isExpoPushToken(token)) {
                await expo.sendPushNotificationsAsync([{
                  to: token,
                  sound: 'default',
                  title: '🚨 EMERGENCY ALERT',
                  body: `Customer ${sos.customerName} needs help!`,
                  data: { type: 'sos', sosId, bookingId: sos.bookingId },
                  channelId: 'bookings',
                  priority: 'high',
                }]);
                console.log('[SOS] Driver notified');
              }
            }
          }
        }
      } catch (e) {
        console.error('[SOS] Notification error:', e);
      }
    }
  }
);