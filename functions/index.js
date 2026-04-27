const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');

admin.initializeApp();

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

exports.quoteFare = onCall({ region: 'asia-south1' }, async (request) => {
  const data = request.data || {};

  // ACCEPT BOTH new and legacy field names so callers don't break
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

  // Compute distance server-side so client can't fake it
  const distanceKm = distanceKmBetween(pickup, drop);
  if (distanceKm == null) {
    throw new HttpsError('invalid-argument', 'Invalid pickup/drop coordinates');
  }

  // 1. Load app settings
  const settingsSnap = await admin.firestore().doc('settings/app').get();
  const settings = settingsSnap.exists ? settingsSnap.data() : {};

  // 2. Find the vehicle config
  const list = service === 'ride'
    ? (settings.rideVehicles || [])
    : (settings.parcelVehicles || []);
  const vehicle = list.find((v) => v.id === vehicleId);
  if (!vehicle) {
    throw new HttpsError('not-found', `Vehicle ${vehicleId} not found in ${service} list`);
  }

  // 3. Trip fare math (rupees, ×100 at the end)
  const baseFare = Number(vehicle.baseFare) || 0;
  const perKm = Number(vehicle.perKm) || 0;
  const distanceFare = Math.round(distanceKm * perKm);
  const tripFare = baseFare + distanceFare;

  // 4. Max possible pickup premium
  const searchRadiusKm = Number(settings.searchRadiusKm) || 5;
  const pickupFreeKm = Number(vehicle.pickupFreeKm) || 2;
  const pickupKmRate = Number(vehicle.pickupKmRate) || 0;
  const billablePickupKm = Math.max(0, searchRadiusKm - pickupFreeKm);
  const maxPickupPremium = Math.round(billablePickupKm * pickupKmRate);

  // 5. Final fare with worst-case premium
  const totalInPaise = (tripFare + maxPickupPremium) * 100;

  // 6. Commission
  const commissionPct = Number(settings.commissionPct) || 20;
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
    // Helpful for admin/debug
    pickupConfig: {
      freeKm: pickupFreeKm,
      ratePerKm: pickupKmRate,
      searchRadiusKm,
    },
  };
});