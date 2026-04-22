import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase';

// Default settings if not found in Firestore
const DEFAULT_SETTINGS = {
  appName: 'LoadGo',
  commissionPct: 20,
  upiId: 'loadgo@upi',
  vehicles: [
    { id: 'bike', label: 'Bike', icon: '🏍️', baseFare: 30, perKm: 8, capacity: '20 kg', enabled: true },
    { id: '3wheeler', label: '3 Wheeler', icon: '🛺', baseFare: 50, perKm: 12, capacity: '300 kg', enabled: true },
    { id: 'chota_hatti', label: 'Chota Hatti', icon: '🚛', baseFare: 70, perKm: 15, capacity: '500 kg', enabled: true },
    { id: 'tempo', label: 'Tempo', icon: '🚚', baseFare: 100, perKm: 20, capacity: '1500 kg', enabled: true },
  ],
};

export function useAppSettings() {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Listen to settings/app document in real-time
    const unsub = onSnapshot(
      doc(db, 'settings', 'app'),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data();
          setSettings({
            appName: data.appName || DEFAULT_SETTINGS.appName,
            commissionPct: data.commissionPct || DEFAULT_SETTINGS.commissionPct,
            upiId: data.upiId || DEFAULT_SETTINGS.upiId,
            vehicles: data.vehicles || DEFAULT_SETTINGS.vehicles,
          });
        } else {
          // If settings don't exist, use defaults
          setSettings(DEFAULT_SETTINGS);
        }
        setLoading(false);
      },
      (error) => {
        console.error('Settings fetch error:', error);
        setSettings(DEFAULT_SETTINGS);
        setLoading(false);
      }
    );

    return () => unsub();
  }, []);

  return { settings, loading };
}