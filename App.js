import React, { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import NetInfo from '@react-native-community/netinfo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AuthProvider, useAuth } from './src/contexts/AuthContext';
import { VersionUpdateModal } from './src/components/VersionUpdateModal';
import LoginScreen from './src/screens/auth/LoginScreen';
import CustomerHome from './src/screens/customer/CustomerHome';
import CustomerBookingsScreen from './src/screens/customer/CustomerBookingsScreen';
import DriverHome from './src/screens/driver/DriverHome';
import DriverEarnings from './src/screens/driver/DriverEarnings';
import ProfileScreen from './src/screens/shared/ProfileScreen';

const Tab = createBottomTabNavigator();

const TAB_STYLE = {
  headerShown: false,
  tabBarActiveTintColor: '#111827',
  tabBarInactiveTintColor: '#9CA3AF',
  tabBarStyle: {
    backgroundColor: '#FFFFFF',
    borderTopColor: '#F3F4F6',
    borderTopWidth: 1,
    paddingTop: 6,
    paddingBottom: Platform.OS === 'android' ? 14 : 22,
    height: Platform.OS === 'android' ? 62 : 78,
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
  },
  tabBarLabelStyle: {
    fontSize: 11,
    fontWeight: '700',
    marginTop: 2,
  },
  tabBarIconStyle: {
    marginBottom: -2,
  },
};

export default function App() {
  const [networkReady, setNetworkReady] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const [hasCachedUser, setHasCachedUser] = useState(false);

  // Check network + cache BEFORE rendering anything
  useEffect(() => {
    const init = async () => {
      try {
        // Check network
        const netState = await NetInfo.fetch();
        const offline = !(netState.isConnected && netState.isInternetReachable !== false);
        setIsOffline(offline);

        // Check if user was previously logged in
        const cachedUid = await AsyncStorage.getItem('cached_uid');
        setHasCachedUser(!!cachedUid);

        console.log('[App] Network:', offline ? 'OFFLINE' : 'ONLINE', '| Cached user:', !!cachedUid);
      } catch (e) {
        console.log('[App] Init error:', e);
      }
      setNetworkReady(true);
    };

    init();

    // Listen for network changes
    const unsubNet = NetInfo.addEventListener((state) => {
      const offline = !(state.isConnected && state.isInternetReachable !== false);
      setIsOffline(offline);
    });

    return () => unsubNet();
  }, []);

  // Still checking network...
  if (!networkReady) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff' }}>
        <ActivityIndicator size="large" color="#10B981" />
      </View>
    );
  }

  // Offline + never logged in before → show "No Internet"
  if (isOffline && !hasCachedUser) {
    return (
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <NoInternetScreen />
      </SafeAreaProvider>
    );
  }

  // Online OR offline with cached user → proceed normally
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <AuthProvider>
        <VersionUpdateModal />
        {isOffline && <OfflineBanner />}
        <AppContent />
      </AuthProvider>
    </SafeAreaProvider>
  );
}

function AppContent() {
  const { user, profile, mode, loading, login } = useAuth();

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff' }}>
        <ActivityIndicator size="large" color="#10B981" />
      </View>
    );
  }

  if (!user || !profile) return <LoginScreen onLogin={login} />;

  if (mode === 'driver' && profile?.isDriver) {
    return (
      <NavigationContainer>
        <Tab.Navigator screenOptions={TAB_STYLE}>
          <Tab.Screen
            name="DriverHome"
            component={DriverHome}
            options={{
              tabBarLabel: 'Home',
              tabBarIcon: ({ focused, color }) => (
                <Ionicons name={focused ? 'car' : 'car-outline'} size={20} color={color} />
              ),
            }}
          />
          <Tab.Screen
            name="DriverEarnings"
            component={DriverEarnings}
            options={{
              tabBarLabel: 'Earnings',
              tabBarIcon: ({ focused, color }) => (
                <Ionicons name={focused ? 'wallet' : 'wallet-outline'} size={20} color={color} />
              ),
            }}
          />
          <Tab.Screen
            name="DriverProfile"
            component={ProfileScreen}
            options={{
              tabBarLabel: 'Profile',
              tabBarIcon: ({ focused, color }) => (
                <Ionicons name={focused ? 'person' : 'person-outline'} size={20} color={color} />
              ),
            }}
          />
        </Tab.Navigator>
      </NavigationContainer>
    );
  }

  return (
    <NavigationContainer>
      <Tab.Navigator screenOptions={TAB_STYLE}>
        <Tab.Screen
          name="Home"
          component={CustomerHome}
          options={{
            tabBarLabel: 'Home',
            tabBarIcon: ({ focused, color }) => (
              <Ionicons name={focused ? 'home' : 'home-outline'} size={20} color={color} />
            ),
          }}
        />
        <Tab.Screen
          name="Bookings"
          component={CustomerBookingsScreen}
          options={{
            tabBarLabel: 'Bookings',
            tabBarIcon: ({ focused, color }) => (
              <Ionicons name={focused ? 'receipt' : 'receipt-outline'} size={20} color={color} />
            ),
          }}
        />
        <Tab.Screen
          name="Profile"
          component={ProfileScreen}
          options={{
            tabBarLabel: 'Profile',
            tabBarIcon: ({ focused, color }) => (
              <Ionicons name={focused ? 'person' : 'person-outline'} size={20} color={color} />
            ),
          }}
        />
      </Tab.Navigator>
    </NavigationContainer>
  );
}

// ─── No Internet Screen ─────────────────────
function NoInternetScreen() {
  return (
    <View style={offlineStyles.container}>
      <View style={offlineStyles.iconCircle}>
        <Ionicons name="cloud-offline" size={60} color="#DC2626" />
      </View>
      <Text style={offlineStyles.title}>No Internet Connection</Text>
      <Text style={offlineStyles.subtitle}>
        Please check your WiFi or mobile data and try again
      </Text>
      <View style={offlineStyles.tipsBox}>
        <Text style={offlineStyles.tipItem}>📶  Turn on WiFi or Mobile Data</Text>
        <Text style={offlineStyles.tipItem}>✈️  Turn off Airplane Mode</Text>
        <Text style={offlineStyles.tipItem}>🔄  Restart your phone if issue persists</Text>
      </View>
      <Text style={offlineStyles.footer}>
        Sarthi will reconnect automatically when internet is available
      </Text>
    </View>
  );
}

// ─── Offline Banner ─────────────────────
function OfflineBanner() {
  return (
    <View style={offlineStyles.banner}>
      <Ionicons name="cloud-offline" size={14} color="#FFFFFF" />
      <Text style={offlineStyles.bannerText}>No internet connection</Text>
    </View>
  );
}

const offlineStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  iconCircle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#FEF2F2',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  title: {
    fontSize: 22,
    fontWeight: '900',
    color: '#111827',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 28,
  },
  tipsBox: {
    backgroundColor: '#F9FAFB',
    borderRadius: 16,
    paddingHorizontal: 20,
    paddingVertical: 16,
    width: '100%',
    marginBottom: 28,
  },
  tipItem: {
    fontSize: 14,
    color: '#374151',
    fontWeight: '600',
    marginBottom: 10,
  },
  footer: {
    fontSize: 12,
    color: '#9CA3AF',
    textAlign: 'center',
    fontWeight: '500',
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#DC2626',
    paddingVertical: 8,
    paddingTop: Platform.OS === 'android' ? 36 : 50,
  },
  bannerText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});