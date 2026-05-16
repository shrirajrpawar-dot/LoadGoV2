import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  signInAnonymously,
  onAuthStateChanged,
  signOut as firebaseSignOut,
} from 'firebase/auth';
import { doc, getDoc, onSnapshot, setDoc, updateDoc } from 'firebase/firestore';
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

  // Monitor network connectivity
  useEffect(() => {
    const unsubNet = NetInfo.addEventListener((state) => {
      const offline = !(state.isConnected && state.isInternetReachable !== false);
      setIsOffline(offline);
      console.log('[Auth] Network:', offline ? 'OFFLINE' : 'ONLINE');
    });
    return () => unsubNet();
  }, []);

  useEffect(() => {
    let unsubProfile = null;
    let unsubDriver = null;

    const unsubAuth = onAuthStateChanged(auth, async (firebaseUser) => {
      // Clean up previous listeners
      if (unsubProfile) unsubProfile();
      if (unsubDriver) unsubDriver();

      if (firebaseUser) {
        setUser(firebaseUser);

        // Cache UID for offline recovery
        try {
          await AsyncStorage.setItem('cached_uid', firebaseUser.uid);
        } catch (e) {}

        // Real-time user profile
        unsubProfile = onSnapshot(
          doc(db, 'users', firebaseUser.uid),
          (snap) => {
            if (snap.exists()) {
              const data = snap.data();
              setProfile(data);
              setMode(data.mode || 'customer');
              // Cache for offline
              AsyncStorage.setItem('cached_profile', JSON.stringify(data)).catch(() => {});
            } else {
              setProfile(null);
              setMode('customer');
            }
            setLoading(false);
          },
          (err) => {
            console.error('Profile listener error:', err);
            // Firestore offline — load cached
            loadCachedData();
          }
        );

        // Real-time driver doc
        unsubDriver = onSnapshot(
          doc(db, 'drivers', firebaseUser.uid),
          (snap) => {
            const data = snap.exists() ? snap.data() : null;
            setDriverDoc(data);
            if (data) {
              AsyncStorage.setItem('cached_driverDoc', JSON.stringify(data)).catch(() => {});
            }
          },
          () => {}
        );
      } else {
        // No Firebase user — try cached data for offline
        try {
          const cachedUid = await AsyncStorage.getItem('cached_uid');
          if (cachedUid) {
            // Try re-auth silently
            try {
              await signInAnonymously(auth);
              // onAuthStateChanged will fire again
              return;
            } catch (authError) {
              // Offline — use cached data
              console.log('[Auth] Offline, using cached data');
              setUser({ uid: cachedUid, isOfflineCached: true });
              await loadCachedData();
              return;
            }
          }
        } catch (e) {
          console.error('[Auth] Cache error:', e);
        }

        // No cached user — show login
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
      const cachedProfile = await AsyncStorage.getItem('cached_profile');
      if (cachedProfile) {
        const data = JSON.parse(cachedProfile);
        setProfile(data);
        setMode(data.mode || 'customer');
      }
      const cachedDriver = await AsyncStorage.getItem('cached_driverDoc');
      if (cachedDriver) {
        setDriverDoc(JSON.parse(cachedDriver));
      }
    } catch (e) {
      console.error('[Auth] Cache parse error:', e);
    }
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
    await updateDoc(doc(db, 'users', user.uid), {
      isDriver: true,
      mode: 'driver',
    });
    // Only create driver doc if it doesn't exist
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
    // Clear cached data on explicit sign out
    try {
      await AsyncStorage.multiRemove(['cached_uid', 'cached_profile', 'cached_driverDoc']);
    } catch (e) {}
    await firebaseSignOut(auth);
    setUser(null);
    setProfile(null);
    setDriverDoc(null);
    setMode('customer');
  };

  return (
    <AuthContext.Provider value={{
      user, profile, driverDoc, mode, loading, isOffline,
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