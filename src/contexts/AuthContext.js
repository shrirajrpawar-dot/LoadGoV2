import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  signInAnonymously,
  onAuthStateChanged,
  signOut as firebaseSignOut,
} from 'firebase/auth';
import { doc, getDoc, onSnapshot, setDoc, updateDoc } from 'firebase/firestore';
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

    const unsubAuth = onAuthStateChanged(auth, (firebaseUser) => {
      // Clean up previous listeners
      if (unsubProfile) unsubProfile();
      if (unsubDriver) unsubDriver();

      if (firebaseUser) {
        setUser(firebaseUser);

        // Real-time user profile
        unsubProfile = onSnapshot(
          doc(db, 'users', firebaseUser.uid),
          (snap) => {
            if (snap.exists()) {
              const data = snap.data();
              setProfile(data);
              setMode(data.mode || 'customer');
            } else {
              setProfile(null);
              setMode('customer');
            }
            setLoading(false);
          },
          (err) => { console.error('Profile error:', err); setLoading(false); }
        );

        // Real-time driver doc
        unsubDriver = onSnapshot(
          doc(db, 'drivers', firebaseUser.uid),
          (snap) => {
            setDriverDoc(snap.exists() ? snap.data() : null);
          },
          () => {}
        );
      } else {
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
    // Only create driver doc if it doesn't exist — don't overwrite earnings/KYC
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
    await firebaseSignOut(auth);
    setUser(null);
    setProfile(null);
    setDriverDoc(null);
    setMode('customer');
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