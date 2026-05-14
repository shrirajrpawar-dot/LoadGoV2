const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
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
//
// SETUP (one-time):
//   1. Sign up at razorpay.com, complete KYC, get key_id and key_secret
//   2. cd functions && npm install razorpay
//   3. firebase functions:secrets:set RAZORPAY_KEY_ID
//      firebase functions:secrets:set RAZORPAY_KEY_SECRET
//      firebase functions:secrets:set RAZORPAY_WEBHOOK_SECRET
//   4. firebase deploy --only functions
//   5. In Razorpay dashboard, set webhook URL to:
//      https://asia-south1-loadgo-dev.cloudfunctions.net/razorpayWebhook
//      with event: "payment.captured"
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


  const functions = require('firebase-functions');
  const admin = require('firebase-admin');
  const { getFirestore } = require('firebase-admin/firestore');
  
  // Initialize Firebase Admin
  if (!admin.apps.length) {
    admin.initializeApp();
  }
  
  const db = getFirestore();
  
  // ============================================
  // EXISTING FUNCTIONS - DO NOT MODIFY
  // ============================================
  
  // Your existing quoteFare function (copy from your current functions)
  // exports.quoteFare = functions.https.onCall(async (data, context) => {
  //   // ... your existing code ...
  // });
  
  // Your existing Razorpay functions (if any)
  // exports.createRazorpayOrder = functions.https.onCall(async (data, context) => {
  //   // ... your existing code ...
  // });
  
  // ============================================
  // NEW: SOS HANDLER - ADDED FOR SAFETY
  // ============================================
  
  /**
   * Triggered when customer creates SOS record
   * Sends alert to driver and creates admin notification
   */
  exports.handleCustomerSOS = functions
    .region('asia-south1')
    .firestore.document('sos/{sosId}')
    .onCreate(async (snap, context) => {
      const sos = snap.data();
      const sosId = snap.id;
  
      try {
        // Get customer details
        const customerSnap = await db.collection('users').doc(sos.customerId).get();
        const customer = customerSnap.data() || {};
  
        // Get booking details
        let booking = null;
        if (sos.bookingId) {
          const bookingSnap = await db.collection('bookings').doc(sos.bookingId).get();
          booking = bookingSnap.data();
        }
  
        // === Alert Driver ===
        if (sos.type === 'driver' && booking?.driverId) {
          const driverSnap = await db.collection('drivers').doc(booking.driverId).get();
          const driver = driverSnap.data();
  
          // Send push notification to driver (if FCM token exists)
          if (driver?.fcmToken) {
            try {
              await admin.messaging().send({
                token: driver.fcmToken,
                notification: {
                  title: '🚨 EMERGENCY ALERT',
                  body: `Customer ${customer.name} has triggered SOS`,
                },
                data: {
                  type: 'sos',
                  sosId,
                  bookingId: sos.bookingId,
                },
              });
            } catch (fcmError) {
              console.log('FCM error (non-critical):', fcmError.message);
            }
          }
  
          // Create notification record
          await db.collection('notifications').add({
            recipientId: booking.driverId,
            type: 'sos_alert',
            title: '🚨 Customer Emergency Alert',
            message: `${customer.name} has triggered SOS`,
            sosId,
            bookingId: sos.bookingId,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            read: false,
          });
        }
  
        // === Alert Support Team ===
        if (sos.type === 'support' || sos.type === 'police') {
          await db.collection('admin-alerts').add({
            type: sos.type === 'police' ? 'police_sos' : 'support_sos',
            customerId: sos.customerId,
            customerName: customer.name,
            customerPhone: customer.phone,
            sosId,
            bookingId: sos.bookingId,
            location: sos.customerLocation,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            status: 'pending',
          });
        }
  
        console.log(`SOS handler completed for: ${sosId}`);
        return { success: true, sosId };
  
      } catch (error) {
        console.error('Error in handleCustomerSOS:', error);
        throw error;
      }
    });
  
  // ============================================
  // NOTE: To keep existing functions
  // ============================================
  // If you have existing functions in your index.js:
  // 1. Copy them here OR
  // 2. Keep them in separate file and export both:
  //    exports.handleCustomerSOS = require('./sos').handleCustomerSOS;
  //    exports.quoteFare = require('./booking').quoteFare;
  //    etc...
  
  // Example of how to preserve existing functions:
  // module.exports = {
  //   handleCustomerSOS: functions.firestore.document(...).onCreate(...),
  //   quoteFare: functions.https.onCall(async (data, context) => { ... }),
  //   // ... other functions
  // };


});