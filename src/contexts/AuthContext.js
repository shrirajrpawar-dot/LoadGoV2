import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import {
  signInAnonymously,
  onAuthStateChanged,
  signOut as firebaseSignOut,
} from 'firebase/auth';
import { doc, getDoc, getDocs, onSnapshot, setDoc, updateDoc, collection, query, where } from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { auth, db } from '../../firebase';

const AuthContext = createContext();

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [driverDoc, setDriverDoc] = useState(null);
  const [mode, setMode] = useState('customer');
  const [loading, setLoading] = useState(true);
  const [isOffline, setIsOffline] = useState(false);
  const hasTriedReauth = useRef(false);

  // ── Load cache immediately ──
  useEffect(() => {
    (async () => {
      try {
        const [uid, prof, drv] = await Promise.all([
          AsyncStorage.getItem('cached_uid'),
          AsyncStorage.getItem('cached_profile'),
          AsyncStorage.getItem('cached_driverDoc'),
        ]);
        if (uid && prof) {
          const p = JSON.parse(prof);
          setUser({ uid, isOfflineCached: true });
          setProfile(p);
          setMode(p.mode || 'customer');
          if (drv) setDriverDoc(JSON.parse(drv));
        }
      } catch (e) {}
    })();
  }, []);

  // ── Network monitoring + re-auth on reconnect ──
  useEffect(() => {
    const unsub = NetInfo.addEventListener(async (state) => {
      const offline = !(state.isConnected && state.isInternetReachable !== false);
      setIsOffline(offline);
      if (!offline && !auth.currentUser && !hasTriedReauth.current) {
        const uid = await AsyncStorage.getItem('cached_uid').catch(() => null);
        if (uid) {
          hasTriedReauth.current = true;
          try { await signInAnonymously(auth); } catch (e) {}
          hasTriedReauth.current = false;
        }
      }
    });
    return () => unsub();
  }, []);

  // ── Firebase auth listener ──
  useEffect(() => {
    let unsubProfile = null;
    let unsubDriver = null;

    const unsubAuth = onAuthStateChanged(auth, async (firebaseUser) => {
      if (unsubProfile) unsubProfile();
      if (unsubDriver) unsubDriver();

      if (firebaseUser) {
        setUser(firebaseUser);
        AsyncStorage.setItem('cached_uid', firebaseUser.uid).catch(() => {});

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
          () => setLoading(false)
        );

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
        try {
          const uid = await AsyncStorage.getItem('cached_uid');
          if (uid) {
            try { await signInAnonymously(auth); return; }
            catch (e) { setLoading(false); return; }
          }
        } catch (e) {}
        setUser(null); setProfile(null); setDriverDoc(null); setMode('customer');
        setLoading(false);
      }
    });

    const timeout = setTimeout(() => setLoading(false), 4000);
    return () => { clearTimeout(timeout); unsubAuth(); if (unsubProfile) unsubProfile(); if (unsubDriver) unsubDriver(); };
  }, []);

  // ── Check if phone exists in Firestore ──
  const checkPhone = async (phone) => {
    try {
      const q = query(collection(db, 'users'), where('phone', '==', phone));
      const snap = await getDocs(q);
      if (snap.empty) return null;
      // Return first matching user's data + their doc ID (old UID)
      const userDoc = snap.docs[0];
      return { id: userDoc.id, ...userDoc.data() };
    } catch (e) {
      console.error('[Auth] checkPhone error:', e);
      return null;
    }
  };

  // ── Login: handles both existing and new users ──
  const login = async (name, email, phone, existingUser) => {
    const result = await signInAnonymously(auth);
    const newUid = result.user.uid;

    if (existingUser && existingUser.id) {
      // Existing user — migrate data to new UID
      const oldUid = existingUser.id;
      const userData = {
        uid: newUid,
        name: existingUser.name || name,
        email: existingUser.email || email,
        phone,
        mode: existingUser.mode || 'customer',
        isDriver: existingUser.isDriver || false,
        createdAt: existingUser.createdAt || new Date().toISOString(),
        migratedFrom: oldUid,
        lastLoginAt: new Date().toISOString(),
      };

      // Create user doc at new UID
      await setDoc(doc(db, 'users', newUid), userData);

      // If driver, migrate driver doc too
      if (existingUser.isDriver) {
        try {
          const oldDriverSnap = await getDoc(doc(db, 'drivers', oldUid));
          if (oldDriverSnap.exists()) {
            const driverData = oldDriverSnap.data();
            await setDoc(doc(db, 'drivers', newUid), {
              ...driverData,
              uid: newUid,
              migratedFrom: oldUid,
            });
          }
        } catch (e) {
          console.log('[Auth] Driver migration skipped:', e.message);
        }
      }
    } else {
      // New user — create fresh user doc
      await setDoc(doc(db, 'users', newUid), {
        uid: newUid,
        name, email, phone,
        mode: 'customer',
        isDriver: false,
        createdAt: new Date().toISOString(),
      });
    }

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
      user, profile, driverDoc, mode, loading, isOffline,
      login, checkPhone, signOut, joinAsDriver, switchMode,
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