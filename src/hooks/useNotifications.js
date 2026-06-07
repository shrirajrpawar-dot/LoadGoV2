import { useEffect, useRef, useState } from 'react';
import { Platform, Alert } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../contexts/AuthContext';

// Configure how notifications appear when app is in foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export function useNotifications() {
  const { user, profile } = useAuth();
  const [expoPushToken, setExpoPushToken] = useState(null);
  const notificationListener = useRef();
  const responseListener = useRef();

  useEffect(() => {
    if (!user?.uid) return;

    // Register for push notifications
    registerForPushNotifications().then(async (token) => {
      if (token) {
        setExpoPushToken(token);
        console.log('[Notifications] Push token:', token);

        // Save token to Firestore (on users doc)
        try {
          await updateDoc(doc(db, 'users', user.uid), {
            expoPushToken: token,
            pushTokenUpdatedAt: new Date().toISOString(),
            devicePlatform: Platform.OS,
          });
        } catch (e) {
          console.log('[Notifications] Failed to save token to users:', e.message);
        }

        // Also save to drivers doc if driver
        if (profile?.isDriver) {
          try {
            await updateDoc(doc(db, 'drivers', user.uid), {
              expoPushToken: token,
              pushTokenUpdatedAt: new Date().toISOString(),
            });
          } catch (e) {
            console.log('[Notifications] Failed to save token to drivers:', e.message);
          }
        }
      }
    });

    // Listen for incoming notifications (app in foreground)
    notificationListener.current = Notifications.addNotificationReceivedListener((notification) => {
      console.log('[Notifications] Received:', notification.request.content);
    });

    // Listen for notification taps (app in background → user taps notification)
    responseListener.current = Notifications.addNotificationResponseReceivedListener((response) => {
      console.log('[Notifications] Tapped:', response.notification.request.content);
      // You can navigate to specific screens based on data here
      const data = response.notification.request.content.data;
      if (data?.type === 'new_booking') {
        // Driver tapped "new booking" notification → app opens to DriverHome
        console.log('[Notifications] New booking notification tapped, bookingId:', data.bookingId);
      }
    });

    return () => {
      if (notificationListener.current) {
        Notifications.removeNotificationSubscription(notificationListener.current);
      }
      if (responseListener.current) {
        Notifications.removeNotificationSubscription(responseListener.current);
      }
    };
  }, [user?.uid, profile?.isDriver]);

  return { expoPushToken };
}

async function registerForPushNotifications() {
  let token;

  // Must be a physical device
  if (!Device.isDevice) {
    console.log('[Notifications] Must use physical device for push notifications');
    return null;
  }

  // Android: Create notification channel
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('bookings', {
      name: 'Booking Alerts',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      sound: 'default',
      lightColor: '#10B981',
    });

    await Notifications.setNotificationChannelAsync('general', {
      name: 'General',
      importance: Notifications.AndroidImportance.HIGH,
      sound: 'default',
    });
  }

  // Check existing permission
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  // Request permission if not granted
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    console.log('[Notifications] Permission not granted');
    return null;
  }

  // Get Expo push token
  try {
    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    token = (await Notifications.getExpoPushTokenAsync({
      projectId,
    })).data;
  } catch (e) {
    console.log('[Notifications] Token error:', e);
    return null;
  }

  return token;
}

// ── Helper: Send local notification (for testing / in-app alerts) ──
export async function sendLocalNotification(title, body, data = {}) {
  await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      data,
      sound: 'default',
      ...(Platform.OS === 'android' && { channelId: 'bookings' }),
    },
    trigger: null, // Immediately
  });
}
