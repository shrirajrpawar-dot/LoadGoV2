import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View, Text, Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { AuthProvider, useAuth } from './src/contexts/AuthContext';
import LoginScreen from './src/screens/auth/LoginScreen';
import CustomerHome from './src/screens/customer/CustomerHome';
import CustomerBookingsScreen from './src/screens/customer/CustomerBookingsScreen';
import DriverHome from './src/screens/driver/DriverHome';
import DriverEarnings from './src/screens/driver/DriverEarnings';
import ProfileScreen from './src/screens/shared/ProfileScreen';

const Tab = createBottomTabNavigator();

const TAB_STYLE = {
  headerShown: false,
  tabBarActiveTintColor: '#10B981',
  tabBarInactiveTintColor: '#9CA3AF',
  tabBarStyle: {
    backgroundColor: '#fff',
    borderTopColor: '#E5E7EB',
    borderTopWidth: 1,
    paddingTop: 8,
    paddingBottom: Platform.OS === 'android' ? 24 : 24,
    height: Platform.OS === 'android' ? 80 : 85,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  tabBarLabelStyle: {
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
  tabBarIconStyle: {
    marginBottom: -2,
  },
};

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <AuthProvider>
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
          <Tab.Screen name="DriverHome" component={DriverHome}
            options={{ tabBarLabel: 'Home', tabBarIcon: () => <Text style={{ fontSize: 22 }}>🚗</Text> }} />
          <Tab.Screen name="DriverEarnings" component={DriverEarnings}
            options={{ tabBarLabel: 'Earnings', tabBarIcon: () => <Text style={{ fontSize: 22 }}>💰</Text> }} />
          <Tab.Screen name="DriverProfile" component={ProfileScreen}
            options={{ tabBarLabel: 'Profile', tabBarIcon: () => <Text style={{ fontSize: 22 }}>👤</Text> }} />
        </Tab.Navigator>
      </NavigationContainer>
    );
  }

  return (
    <NavigationContainer>
      <Tab.Navigator screenOptions={TAB_STYLE}>
        <Tab.Screen name="Home" component={CustomerHome}
          options={{ tabBarLabel: 'Home', tabBarIcon: () => <Text style={{ fontSize: 22 }}>🏠</Text> }} />
        <Tab.Screen name="Bookings" component={CustomerBookingsScreen}
          options={{ tabBarLabel: 'Bookings', tabBarIcon: () => <Text style={{ fontSize: 22 }}>📋</Text> }} />
        <Tab.Screen name="Profile" component={ProfileScreen}
          options={{ tabBarLabel: 'Profile', tabBarIcon: () => <Text style={{ fontSize: 22 }}>👤</Text> }} />
      </Tab.Navigator>
    </NavigationContainer>
  );
}