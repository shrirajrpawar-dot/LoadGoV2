import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase';

// Default parcel vehicles
const DEFAULT_PARCEL_VEHICLES = [
  { id: 'bike', label: 'Bike', icon: '🏍️', baseFare: 30, perKm: 8, capacity: '20 kg', commission: 20, enabled: true, service: 'parcel' },
  { id: 'scooty', label: 'Scooty', icon: '🛵', baseFare: 40, perKm: 10, capacity: '50 kg', commission: 20, enabled: true, service: 'parcel' },
  { id: '3wheeler_transport', label: '3 Wheeler Transport', icon: '🛺', baseFare: 50, perKm: 12, capacity: '300 kg', commission: 18, enabled: true, service: 'parcel' },
  { id: 'chota_hatti', label: 'Chota Hatti', icon: '🚛', baseFare: 70, perKm: 15, capacity: '500 kg', commission: 15, enabled: true, service: 'parcel' },
  { id: 'tempo', label: 'Tempo', icon: '🚚', baseFare: 100, perKm: 20, capacity: '1500 kg', commission: 15, enabled: true, service: 'parcel' },
];

// Default ride vehicles
const DEFAULT_RIDE_VEHICLES = [
  { id: 'bike', label: 'Bike', icon: '🏍️', baseFare: 50, perKm: 15, capacity: '1 Pax', commission: 25, enabled: true, service: 'ride' },
  { id: 'scooty', label: 'Scooty', icon: '🛵', baseFare: 60, perKm: 18, capacity: '2 Pax', commission: 25, enabled: true, service: 'ride' },
  { id: '3wheeler', label: '3 Wheeler Rickshaw', icon: '🛺', baseFare: 40, perKm: 12, capacity: '3 Pax', commission: 20, enabled: true, service: 'ride' },
  { id: 'sedan', label: 'Sedan', icon: '🚗', baseFare: 100, perKm: 25, capacity: '4 Pax', commission: 30, enabled: true, service: 'ride' },
  { id: 'hatchback', label: 'Hatchback', icon: '🚙', baseFare: 80, perKm: 20, capacity: '4 Pax', commission: 28, enabled: true, service: 'ride' },
  { id: '7seater', label: '7 Seater', icon: '🚐', baseFare: 150, perKm: 30, capacity: '7 Pax', commission: 30, enabled: true, service: 'ride' },
];

export const useAppSettings = () => {
  const [settings, setSettings] = useState({
    parcelVehicles: DEFAULT_PARCEL_VEHICLES,
    rideVehicles: DEFAULT_RIDE_VEHICLES,
    commissionPct: 20,
    upiId: 'loadgo@upi',
    appName: 'LoadGo',
  });

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'settings', 'app'), (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        setSettings({
          parcelVehicles: data.parcelVehicles || DEFAULT_PARCEL_VEHICLES,
          rideVehicles: data.rideVehicles || DEFAULT_RIDE_VEHICLES,
          commissionPct: data.commissionPct || 20,
          upiId: data.upiId || 'loadgo@upi',
          appName: data.appName || 'LoadGo',
        });
      } else {
        setSettings({
          parcelVehicles: DEFAULT_PARCEL_VEHICLES,
          rideVehicles: DEFAULT_RIDE_VEHICLES,
          commissionPct: 20,
          upiId: 'loadgo@upi',
          appName: 'LoadGo',
        });
      }
    });
    return () => unsub();
  }, []);

  return { settings };
};