import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Alert, Modal, Linking,
  ScrollView, ActivityIndicator, SafeAreaView, Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { doc, updateDoc, addDoc, collection, serverTimestamp } from 'firebase/firestore';
import * as Location from 'expo-location';
import { db } from '../../firebase';
import { useAuth } from '../contexts/AuthContext';

const { height } = Dimensions.get('window');

export function SOSButton({ booking, position }) {
  const { user, profile } = useAuth();
  const [sosVisible, setSosVisible] = useState(false);
  const [sosActive, setSosActive] = useState(false);
  const [sosLoading, setSosLoading] = useState(false);
  const [locationSharing, setLocationSharing] = useState(false);

  // Get current location
  const getCurrentLocation = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Denied', 'Location permission is required');
        return null;
      }
      const location = await Location.getCurrentPositionAsync({});
      return {
        lat: location.coords.latitude,
        lng: location.coords.longitude,
      };
    } catch (e) {
      console.log('Location error:', e);
      return position || null;
    }
  };

  const triggerSOS = async (type) => {
    setSosLoading(true);
    try {
      // Get current location
      const currentLocation = await getCurrentLocation();

      // Create SOS record in Firestore
      const sosDoc = await addDoc(collection(db, 'sos'), {
        customerId: user.uid,
        customerName: profile?.name || 'Unknown',
        customerPhone: profile?.phone || '',
        type, // 'driver', 'support', 'police'
        bookingId: booking?.id || null,
        pickupLocation: booking?.pickup || currentLocation || {},
        dropLocation: booking?.drop || {},
        customerLocation: currentLocation || position || {},
        triggeredAt: serverTimestamp(),
        status: 'active',
        notes: '',
      });

      // Update booking if driver SOS
      if (booking?.id && type === 'driver') {
        await updateDoc(doc(db, 'bookings', booking.id), {
          sosTriggered: true,
          sosTriggeredAt: serverTimestamp(),
          sosTriggeredBy: 'customer',
        });
      }

      setSosActive(true);
      setSosVisible(false);

      Alert.alert(
        '🚨 SOS Activated',
        type === 'driver'
          ? '✓ Driver has been alerted. Support team is being notified.'
          : type === 'support'
            ? '✓ Support team has been notified. They will call you shortly.'
            : '✓ Emergency services have been contacted. Stay safe.',
        [{ text: 'OK' }]
      );

      // Auto-deactivate after 30 minutes
      setTimeout(() => {
        setSosActive(false);
      }, 30 * 60 * 1000);
    } catch (e) {
      console.log('SOS Error:', e);
      Alert.alert('Error', e.message || 'Failed to trigger SOS. Please try again.');
    } finally {
      setSosLoading(false);
    }
  };

  const shareLocation = async () => {
    setLocationSharing(true);
    try {
      // Request location permission
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Denied', 'Location permission is required to share location');
        return;
      }

      // Get location
      const currentLocation = await Location.getCurrentPositionAsync({});
      const lat = currentLocation.coords.latitude;
      const lng = currentLocation.coords.longitude;

      // Create SOS record with location
      await addDoc(collection(db, 'sos'), {
        customerId: user.uid,
        customerName: profile?.name || 'Unknown',
        customerPhone: profile?.phone || '',
        type: 'support', // Share location goes to support
        bookingId: booking?.id || null,
        pickupLocation: booking?.pickup || {},
        dropLocation: booking?.drop || {},
        customerLocation: {
          lat,
          lng,
          address: `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
        },
        triggeredAt: serverTimestamp(),
        status: 'active',
        notes: 'Customer shared live location',
        locationSharing: true,
        locationSharingEndsAt: serverTimestamp(), // Will be + 30 min on cloud function
      });

      setSosActive(true);
      setSosVisible(false);

      Alert.alert(
        '📍 Location Shared',
        'Your live location is now shared with Sarthi support team for 30 minutes',
        [{ text: 'OK' }]
      );

      // Auto-stop sharing after 30 minutes
      setTimeout(() => {
        setSosActive(false);
      }, 30 * 60 * 1000);
    } catch (e) {
      console.log('Location Sharing Error:', e);
      Alert.alert('Error', 'Failed to share location. Please try again.');
    } finally {
      setLocationSharing(false);
    }
  };

  const cancelSOS = async () => {
    if (!sosActive) return;
    try {
      setSosActive(false);
      Alert.alert('SOS Cancelled', 'Your emergency alert has been deactivated.');
    } catch (e) {
      Alert.alert('Error', e.message);
    }
  };

  return (
    <>
      {/* SOS Button */}
      <TouchableOpacity
        style={[s.sosButton, sosActive && s.sosButtonActive]}
        onPress={() => setSosVisible(true)}
        disabled={sosLoading}
      >
        {sosLoading ? (
          <ActivityIndicator color="#FFFFFF" size="large" />
        ) : (
          <>
            <Ionicons
              name={sosActive ? 'alert-circle' : 'warning'}
              size={32}
              color="#FFFFFF"
            />
            <Text style={s.sosButtonText}>{sosActive ? 'SOS' : 'SOS'}</Text>
          </>
        )}
      </TouchableOpacity>

      {/* SOS Modal */}
      <Modal
        visible={sosVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setSosVisible(false)}
      >
        <View style={s.overlay}>
          <View style={s.sosModal}>
            <View style={s.sosHeader}>
              <Ionicons name="alert-circle" size={28} color="#DC2626" />
              <Text style={s.sosTitle}>Emergency Help</Text>
              <TouchableOpacity
                onPress={() => setSosVisible(false)}
                style={s.closeBtn}
              >
                <Ionicons name="close" size={24} color="#6B7280" />
              </TouchableOpacity>
            </View>

            <Text style={s.sosSubtitle}>
              Choose who you want to contact:
            </Text>

            <ScrollView style={s.sosOptions} showsVerticalScrollIndicator={false}>
              {/* Contact Driver */}
              <TouchableOpacity
                style={s.sosOption}
                onPress={() => triggerSOS('driver')}
                disabled={sosLoading}
              >
                <View style={s.sosOptionIcon}>
                  <Ionicons name="car" size={24} color="#10B981" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.sosOptionTitle}>Alert Driver</Text>
                  <Text style={s.sosOptionDesc}>
                    Your driver will be immediately notified of your emergency
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color="#D1D5DB" />
              </TouchableOpacity>

              {/* Contact Support */}
              <TouchableOpacity
                style={s.sosOption}
                onPress={() => triggerSOS('support')}
                disabled={sosLoading}
              >
                <View style={s.sosOptionIcon}>
                  <Ionicons name="headset" size={24} color="#3B82F6" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.sosOptionTitle}>Contact Support</Text>
                  <Text style={s.sosOptionDesc}>
                    Sarthi support team will call you within 2 minutes
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color="#D1D5DB" />
              </TouchableOpacity>

              {/* Call Police */}
              <TouchableOpacity
                style={s.sosOption}
                onPress={() => {
                  Alert.alert(
                    'Call Police?',
                    'This will call emergency services (100 in India)',
                    [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: 'Call Now',
                        onPress: () => {
                          triggerSOS('police');
                          Linking.openURL('tel:100');
                        },
                      },
                    ]
                  );
                }}
                disabled={sosLoading}
              >
                <View style={s.sosOptionIcon}>
                  <Ionicons name="shield" size={24} color="#DC2626" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.sosOptionTitle}>Call Police</Text>
                  <Text style={s.sosOptionDesc}>
                    Will call emergency services (100) and notify Sarthi
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color="#D1D5DB" />
              </TouchableOpacity>

              {/* Share Live Location */}
              <TouchableOpacity
                style={s.sosOption}
                onPress={shareLocation}
                disabled={locationSharing}
              >
                <View style={s.sosOptionIcon}>
                  <Ionicons name="location" size={24} color="#F59E0B" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.sosOptionTitle}>Share Live Location</Text>
                  <Text style={s.sosOptionDesc}>
                    Real-time location shared with Sarthi support team for 30 minutes
                  </Text>
                </View>
                {locationSharing ? (
                  <ActivityIndicator size="small" color="#6B7280" />
                ) : (
                  <Ionicons name="chevron-forward" size={20} color="#D1D5DB" />
                )}
              </TouchableOpacity>
            </ScrollView>

            <View style={s.sosFooter}>
              <Text style={s.sosFooterText}>
                ℹ️ Your location and booking details will be shared with the appropriate contacts
              </Text>
              <TouchableOpacity
                style={s.cancelBtn}
                onPress={() => setSosVisible(false)}
              >
                <Text style={s.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* SOS Status Indicator - Minimal, no layout break */}
      {sosActive && (
        <View style={s.sosStatusDot}>
          <Ionicons name="alert-circle" size={16} color="#FFFFFF" />
        </View>
      )}
    </>
  );
}

const s = StyleSheet.create({
  sosButton: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: '#DC2626',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#DC2626',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  sosButtonActive: {
    backgroundColor: '#991B1B',
    shadowOpacity: 0.5,
  },
  sosButtonText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '900',
    marginTop: 4,
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  sosModal: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: height * 0.85,
    paddingTop: 16,
  },
  sosHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  sosTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: '#111827',
    marginLeft: 12,
    flex: 1,
  },
  closeBtn: {
    padding: 8,
    marginRight: -8,
  },
  sosSubtitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6B7280',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  sosOptions: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  sosOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 12,
    marginBottom: 8,
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  sosOptionIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  sosOptionTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 2,
  },
  sosOptionDesc: {
    fontSize: 12,
    color: '#6B7280',
    lineHeight: 16,
  },
  sosFooter: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
  },
  sosFooterText: {
    fontSize: 12,
    color: '#6B7280',
    fontWeight: '500',
    marginBottom: 12,
    lineHeight: 16,
  },
  cancelBtn: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: '#F3F4F6',
    borderRadius: 10,
    alignItems: 'center',
  },
  cancelBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#6B7280',
  },
  // Minimal status indicator - doesn't break layout
  sosStatusDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#DC2626',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: -10,
  },
});