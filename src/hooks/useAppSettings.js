import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase';

// Default parcel vehicles
// pickupFreeKm: distance from driver→pickup that's included free (default 2km)
// pickupKmRate: ₹/km charged ABOVE pickupFreeKm (per vehicle)
const DEFAULT_PARCEL_VEHICLES = [
  { id: 'bike',                label: 'Bike',                 icon: '🏍️', baseFare: 30,  perKm: 8,  capacity: '20 kg',   commission: 20, pickupFreeKm: 2, pickupKmRate: 5,  enabled: true, service: 'parcel' },
  { id: 'scooty',              label: 'Scooty',               icon: '🛵', baseFare: 40,  perKm: 10, capacity: '50 kg',   commission: 20, pickupFreeKm: 2, pickupKmRate: 6,  enabled: true, service: 'parcel' },
  { id: '3wheeler_transport',  label: '3 Wheeler Transport',  icon: '🛺', baseFare: 50,  perKm: 12, capacity: '300 kg',  commission: 18, pickupFreeKm: 2, pickupKmRate: 8,  enabled: true, service: 'parcel' },
  { id: 'chota_hatti',         label: 'Chota Hatti',          icon: '🚛', baseFare: 70,  perKm: 15, capacity: '500 kg',  commission: 15, pickupFreeKm: 2, pickupKmRate: 10, enabled: true, service: 'parcel' },
  { id: 'tempo',               label: 'Tempo',                icon: '🚚', baseFare: 100, perKm: 20, capacity: '1500 kg', commission: 15, pickupFreeKm: 2, pickupKmRate: 15, enabled: true, service: 'parcel' },
];

const DEFAULT_RIDE_VEHICLES = [
  { id: 'bike',       label: 'Bike',              icon: '🏍️', baseFare: 50,  perKm: 15, capacity: '1 Pax', commission: 25, pickupFreeKm: 2, pickupKmRate: 5,  enabled: true, service: 'ride' },
  { id: 'scooty',     label: 'Scooty',            icon: '🛵', baseFare: 60,  perKm: 18, capacity: '2 Pax', commission: 25, pickupFreeKm: 2, pickupKmRate: 6,  enabled: true, service: 'ride' },
  { id: '3wheeler',   label: '3 Wheeler Rickshaw',icon: '🛺', baseFare: 40,  perKm: 12, capacity: '3 Pax', commission: 20, pickupFreeKm: 2, pickupKmRate: 7,  enabled: true, service: 'ride' },
  { id: 'sedan',      label: 'Sedan',             icon: '🚗', baseFare: 100, perKm: 25, capacity: '4 Pax', commission: 30, pickupFreeKm: 2, pickupKmRate: 12, enabled: true, service: 'ride' },
  { id: 'hatchback',  label: 'Hatchback',         icon: '🚙', baseFare: 80,  perKm: 20, capacity: '4 Pax', commission: 28, pickupFreeKm: 2, pickupKmRate: 10, enabled: true, service: 'ride' },
  { id: '7seater',    label: '7 Seater',          icon: '🚐', baseFare: 150, perKm: 30, capacity: '7 Pax', commission: 30, pickupFreeKm: 2, pickupKmRate: 18, enabled: true, service: 'ride' },
];

const DEFAULT_PAYMENT_METHODS = {
  cod:         { enabled: true,  label: 'Cash on Delivery' },
  upi_direct:  { enabled: true,  label: 'Pay Driver via UPI' },
  razorpay:    { enabled: false, label: 'Pay via Razorpay' },
};

export const useAppSettings = () => {
  const [settings, setSettings] = useState({
    parcelVehicles: DEFAULT_PARCEL_VEHICLES,
    rideVehicles: DEFAULT_RIDE_VEHICLES,
    commissionPct: 20,
    upiId: 'sarthi@upi',
    appName: 'Sarthi',
    searchRadiusKm: 5,
    maxOwedCommission: 500,
    paymentMethods: DEFAULT_PAYMENT_METHODS,
    razorpayKeyId: '',
  });

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'settings', 'app'), (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        const mergeVehicleDefaults = (saved, defaults) =>
          (saved || defaults).map((v) => {
            const def = defaults.find((d) => d.id === v.id) || {};
            return {
              ...def,
              ...v,
              pickupFreeKm: v.pickupFreeKm ?? def.pickupFreeKm ?? 2,
              pickupKmRate: v.pickupKmRate ?? def.pickupKmRate ?? 5,
            };
          });
        setSettings({
          parcelVehicles: mergeVehicleDefaults(data.parcelVehicles, DEFAULT_PARCEL_VEHICLES),
          rideVehicles: mergeVehicleDefaults(data.rideVehicles, DEFAULT_RIDE_VEHICLES),
          commissionPct: data.commissionPct || 20,
          upiId: data.upiId || 'sarthi@upi',
          appName: data.appName || 'Sarthi',
          searchRadiusKm: data.searchRadiusKm || 5,
          maxOwedCommission: data.maxOwedCommission ?? 500,
          paymentMethods: { ...DEFAULT_PAYMENT_METHODS, ...(data.paymentMethods || {}) },
          razorpayKeyId: data.razorpayKeyId || '',
        });
      } else {
        setSettings({
          parcelVehicles: DEFAULT_PARCEL_VEHICLES,
          rideVehicles: DEFAULT_RIDE_VEHICLES,
          commissionPct: 20,
          upiId: 'sarthi@upi',
          appName: 'Sarthi',
          searchRadiusKm: 5,
          maxOwedCommission: 500,
          paymentMethods: DEFAULT_PAYMENT_METHODS,
          razorpayKeyId: '',
        });
      }
    });
    return () => unsub();
  }, []);

  return { settings };
};