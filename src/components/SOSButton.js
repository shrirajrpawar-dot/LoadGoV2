import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Alert, Modal, Linking,
  ScrollView, ActivityIndicator, Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { addDoc, collection, serverTimestamp, updateDoc, doc } from 'firebase/firestore';
import * as Location from 'expo-location';
import { db } from '../../firebase';
import { useAuth } from '../contexts/AuthContext';

const { height } = Dimensions.get('window');

export function SOSButton({ booking, position }) {
  const { user, profile } = useAuth();
  const [sosVisible, setSosVisible] = useState(false);
  const [sosActive, setSosActive] = useState(false);
  const [sosLoading, setSosLoading] = useState(false);
  const [sosDocId, setSosDocId] = useState(null);

  const getCurrentLocation = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Denied', 'Location permission is required');
        return null;
      }
      const loc = await Location.getCurrentPositionAsync({});
      return { lat: loc.coords.latitude, lng: loc.coords.longitude };
    } catch (e) {
      return position || null;
    }
  };

  const triggerSOS = async (type) => {
    setSosLoading(true);
    try {
      const currentLocation = await getCurrentLocation();

      const sosDoc = await addDoc(collection(db, 'sos'), {
        customerId: user.uid,
        customerName: profile?.name || 'Unknown',
        customerPhone: profile?.phone || '',
        type,
        bookingId: booking?.id || null,
        pickupLocation: booking?.pickup || currentLocation || {},
        dropLocation: booking?.drop || {},
        customerLocation: currentLocation || position || {},
        triggeredAt: serverTimestamp(),
        status: 'active',
        notes: '',
      });

      setSosDocId(sosDoc.id);

      if (booking?.id) {
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
        type === 'support'
          ? '✓ Sarthi support team has been notified. They will call you shortly.'
          : '✓ Emergency services have been contacted. Stay safe.',
        [{ text: 'OK' }]
      );
    } catch (e) {
      Alert.alert('Error', e.message || 'Failed to trigger SOS. Please try again.');
    } finally {
      setSosLoading(false);
    }
  };

  const deactivateSOS = () => {
    Alert.alert(
      'Deactivate SOS?',
      'Are you sure you want to cancel your emergency alert?',
      [
        { text: 'Keep Active', style: 'cancel' },
        {
          text: 'Deactivate',
          style: 'destructive',
          onPress: async () => {
            try {
              if (sosDocId) {
                await updateDoc(doc(db, 'sos', sosDocId), {
                  status: 'resolved',
                  resolvedAt: new Date().toISOString(),
                  resolvedBy: 'customer_cancelled',
                });
              }
              setSosActive(false);
              setSosDocId(null);
              Alert.alert('SOS Deactivated', 'Your emergency alert has been cancelled.');
            } catch (e) {
              Alert.alert('Error', 'Could not deactivate. Please try again.');
            }
          },
        },
      ]
    );
  };

  return (
    <>
      {/* SOS Button — tap to open options OR deactivate if active */}
      <TouchableOpacity
        style={[s.sosButton, sosActive && s.sosButtonActive]}
        onPress={() => {
          if (sosActive) {
            deactivateSOS();
          } else {
            setSosVisible(true);
          }
        }}
        disabled={sosLoading}
      >
        {sosLoading ? (
          <ActivityIndicator color="#FFFFFF" size="small" />
        ) : (
          <>
            <Ionicons
              name={sosActive ? 'close-circle' : 'warning'}
              size={28}
              color="#FFFFFF"
            />
            <Text style={s.sosButtonText}>{sosActive ? 'STOP' : 'SOS'}</Text>
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
              <TouchableOpacity onPress={() => setSosVisible(false)} style={s.closeBtn}>
                <Ionicons name="close" size={24} color="#6B7280" />
              </TouchableOpacity>
            </View>

            <Text style={s.sosSubtitle}>Choose an option:</Text>

            <ScrollView style={s.sosOptions} showsVerticalScrollIndicator={false}>
              {/* Alert Sarthi */}
              <TouchableOpacity
                style={s.sosOption}
                onPress={() => triggerSOS('support')}
                disabled={sosLoading}
              >
                <View style={[s.sosOptionIcon, { borderColor: '#DBEAFE' }]}>
                  <Ionicons name="headset" size={28} color="#3B82F6" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.sosOptionTitle}>Alert Sarthi</Text>
                  <Text style={s.sosOptionDesc}>
                    Sarthi support team will be notified immediately and will call you within 2 minutes
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color="#D1D5DB" />
              </TouchableOpacity>

              {/* Call Police */}
              <TouchableOpacity
                style={[s.sosOption, { borderColor: '#FECACA' }]}
                onPress={() => {
                  Alert.alert(
                    'Call Police?',
                    'This will call emergency services (100) and notify Sarthi team',
                    [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: 'Call Now',
                        style: 'destructive',
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
                <View style={[s.sosOptionIcon, { borderColor: '#FECACA', backgroundColor: '#FEF2F2' }]}>
                  <Ionicons name="shield" size={28} color="#DC2626" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[s.sosOptionTitle, { color: '#DC2626' }]}>Call Police</Text>
                  <Text style={s.sosOptionDesc}>
                    Calls emergency services (100) and sends your location to Sarthi
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color="#D1D5DB" />
              </TouchableOpacity>
            </ScrollView>

            <View style={s.sosFooter}>
              <Text style={s.sosFooterText}>
                ℹ️ Your location and booking details will be shared automatically
              </Text>
              <TouchableOpacity style={s.cancelBtn} onPress={() => setSosVisible(false)}>
                <Text style={s.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Active SOS dot indicator */}
      {sosActive && (
        <View style={s.sosStatusDot} />
      )}
    </>
  );
}

const s = StyleSheet.create({
  sosButton: {
    width: 64,
    height: 64,
    borderRadius: 32,
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
  },
  sosButtonText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '900',
    marginTop: 2,
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
    maxHeight: height * 0.55,
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
  closeBtn: { padding: 8, marginRight: -8 },
  sosSubtitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6B7280',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  sosOptions: {
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  sosOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 14,
    marginBottom: 10,
    backgroundColor: '#F9FAFB',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  sosOptionIcon: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  sosOptionTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 3,
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
    backgroundColor: '#F3F4F6',
    borderRadius: 10,
    alignItems: 'center',
  },
  cancelBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#6B7280',
  },
  sosStatusDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#DC2626',
    position: 'absolute',
    top: -2,
    right: -2,
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
});