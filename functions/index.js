const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');

admin.initializeApp();

function distanceKm(a, b) {
  const toRad = v => (v * Math.PI) / 180;
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
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Login required');
  }

  const { serviceType, vehicleType, pickup, drop } = request.data || {};

  if (!serviceType || !vehicleType || !pickup || !drop) {
    throw new HttpsError('invalid-argument', 'Missing quote fields');
  }

  const snap = await admin.firestore().doc('settings/app').get();
  const settings = snap.data() || {};

  const vehicles = serviceType === 'ride'
    ? settings.rideVehicles || []
    : settings.parcelVehicles || [];

  const vehicle = vehicles.find(v => v.id === vehicleType && v.enabled !== false);

  if (!vehicle) {
    throw new HttpsError('not-found', 'Vehicle not available');
  }

  const km = distanceKm(pickup, drop);
  const baseFare = Math.round((vehicle.baseFare || 0) * 100);
  const distanceFare = Math.round(km * (vehicle.perKm || 0) * 100);
  const totalInPaise = baseFare + distanceFare;

  const commissionPct = vehicle.commission || settings.commissionPct || 20;
  const commissionAmount = Math.round(totalInPaise * commissionPct / 100);

  return {
    distanceKm: km,
    fare: { baseFare, distanceFare, totalInPaise },
    commission: {
      pct: commissionPct,
      amountInPaise: commissionAmount,
      status: 'pending_from_driver',
    },
  };
});
