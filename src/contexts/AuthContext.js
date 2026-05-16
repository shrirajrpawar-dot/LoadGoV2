import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  signInAnonymously,
  onAuthStateChanged,
  signOut as firebaseSignOut,
} from 'firebase/auth';
import { doc, getDoc, onSnapshot, setDoc, updateDoc } from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { auth, db } from '../../firebase';

const AuthContext = createContext();

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [driverDoc, setDriverDoc] = useState(null);
  const [mode, setMode] = useState('customer');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let unsubProfile = null;
    let unsubDriver = null;

    const unsubAuth = onAuthStateChanged(auth, async (firebaseUser) => {
      if (unsubProfile) unsubProfile();
      if (unsubDriver) unsubDriver();

      if (firebaseUser) {
        setUser(firebaseUser);

        // Cache UID
        try { await AsyncStorage.setItem('cached_uid', firebaseUser.uid); } catch (e) {}

        // Real-time user profile
        unsubProfile = onSnapshot(
          doc(db, 'users', firebaseUser.uid),
          (snap) => {
            if (snap.exists()) {
              const data = snap.data();
              setProfile(data);
              setMode(data.mode || 'customer');
              AsyncStorage.setItem('cached_profile', JSON.stringify(data)).catch(() => {});
            } else {
              setProfile(null);
              setMode('customer');
            }
            setLoading(false);
          },
          async (err) => {
            console.error('Profile error:', err);
            // Firestore offline — load cached
            await loadCachedData();
          }
        );

        // Real-time driver doc
        unsubDriver = onSnapshot(
          doc(db, 'drivers', firebaseUser.uid),
          (snap) => {
            const data = snap.exists() ? snap.data() : null;
            setDriverDoc(data);
            if (data) AsyncStorage.setItem('cached_driverDoc', JSON.stringify(data)).catch(() => {});
          },
          () => {}
        );
      } else {
        // No Firebase user — try re-auth or use cache
        try {
          const cachedUid = await AsyncStorage.getItem('cached_uid');
          if (cachedUid) {
            try {
              await signInAnonymously(auth);
              return; // onAuthStateChanged fires again
            } catch (e) {
              // Can't re-auth — use cached data
              setUser({ uid: cachedUid, isOfflineCached: true });
              await loadCachedData();
              return;
            }
          }
        } catch (e) {}

        setUser(null);
        setProfile(null);
        setDriverDoc(null);
        setMode('customer');
        setLoading(false);
      }
    });

    return () => {
      unsubAuth();
      if (unsubProfile) unsubProfile();
      if (unsubDriver) unsubDriver();
    };
  }, []);

  const loadCachedData = async () => {
    try {
      const cp = await AsyncStorage.getItem('cached_profile');
      if (cp) { const d = JSON.parse(cp); setProfile(d); setMode(d.mode || 'customer'); }
      const cd = await AsyncStorage.getItem('cached_driverDoc');
      if (cd) setDriverDoc(JSON.parse(cd));
    } catch (e) {}
    setLoading(false);
  };

  const login = async (name, email, phone) => {
    const result = await signInAnonymously(auth);
    await setDoc(doc(db, 'users', result.user.uid), {
      uid: result.user.uid,
      name, email, phone,
      mode: 'customer',
      isDriver: false,
      createdAt: new Date().toISOString(),
    });
    return result.user;
  };

  const joinAsDriver = async () => {
    if (!user?.uid) return;
    await updateDoc(doc(db, 'users', user.uid), { isDriver: true, mode: 'driver' });
    const driverRef = doc(db, 'drivers', user.uid);
    const driverSnap = await getDoc(driverRef);
    if (!driverSnap.exists()) {
      await setDoc(driverRef, {
        uid: user.uid,
        name: profile?.name || '',
        phone: profile?.phone || '',
        email: profile?.email || '',
        status: 'offline',
        earnings: { todayInPaise: 0, totalInPaise: 0 },
        kyc: { status: 'not_started' },
        vehicle: {},
        createdAt: new Date().toISOString(),
      });
    }
  };

  const switchMode = async (newMode) => {
    if (!user?.uid) return;
    await updateDoc(doc(db, 'users', user.uid), { mode: newMode });
  };

  const signOut = async () => {
    try { await AsyncStorage.multiRemove(['cached_uid', 'cached_profile', 'cached_driverDoc']); } catch (e) {}
    await firebaseSignOut(auth);
    setUser(null); setProfile(null); setDriverDoc(null); setMode('customer');
  };

  return (
    <AuthContext.Provider value={{
      user, profile, driverDoc, mode, loading,
      login, signOut, joinAsDriver, switchMode,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}