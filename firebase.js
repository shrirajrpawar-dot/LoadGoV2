import { initializeApp, getApps, getApp } from 'firebase/app';
import { initializeAuth, getReactNativePersistence, getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import AsyncStorage from '@react-native-async-storage/async-storage';

const firebaseConfig = {
  apiKey: "AIzaSyCL-gxxcxfjFgWDPvzKlMkXGMfq2igK3ZA",
  authDomain: "loadgo-dev.firebaseapp.com",
  projectId: "loadgo-dev",
  storageBucket: "loadgo-dev.firebasestorage.app",
  messagingSenderId: "470719393810",
  appId: "1:470719393810:web:aee8e35bced6522f6568cb",
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

let auth;
try {
  auth = initializeAuth(app, {
    persistence: getReactNativePersistence(AsyncStorage),
  });
} catch (e) {
  auth = getAuth(app);
}

export { auth };
export const db = getFirestore(app);
export const storage = getStorage(app);
export default app;