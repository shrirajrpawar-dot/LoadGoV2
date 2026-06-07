import React, { useState, useEffect } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, Linking, Platform } from 'react-native';
import { getDoc, doc } from 'firebase/firestore';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { db } from '../../firebase';

const APP_VERSION = Constants.expoConfig?.version || '1.0.0';

// Compare versions: returns -1 if a < b, 0 if equal, 1 if a > b
function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na < nb) return -1;
    if (na > nb) return 1;
  }
  return 0;
}

export function VersionUpdateModal() {
  const [visible, setVisible] = useState(false);
  const [updateData, setUpdateData] = useState(null);

  useEffect(() => {
    checkForUpdate();
  }, []);

  const checkForUpdate = async () => {
    try {
      const snap = await getDoc(doc(db, 'settings', 'app-version'));
      if (!snap.exists()) return;

      const data = snap.data();
      console.log('[Version] Current:', APP_VERSION, '| Latest:', data.latest, '| Mode:', data.mode);

      // Check if update is available
      if (compareVersions(APP_VERSION, data.latest) < 0) {
        setUpdateData(data);
        // Show popup only for 'force' or 'optional' modes
        if (data.mode === 'force' || data.mode === 'optional') {
          setVisible(true);
        }
      }
    } catch (e) {
      console.log('[Version] Check failed (probably offline):', e.message);
    }
  };

  const openStore = () => {
    // Use admin-configured URL first
    if (updateData?.storeUrl) {
      Linking.openURL(updateData.storeUrl);
      return;
    }
    // Fallback: construct Play Store URL from package name
    const pkg = Constants.expoConfig?.android?.package;
    if (Platform.OS === 'android' && pkg) {
      Linking.openURL(`https://play.google.com/store/apps/details?id=${pkg}`);
    }
  };

  if (!updateData) return null;

  const isForce = updateData.mode === 'force';
  const features = Array.isArray(updateData.features) ? updateData.features : [];

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={() => {
        if (!isForce) setVisible(false);
      }}
    >
      <View style={s.overlay}>
        <View style={s.card}>
          {/* Icon */}
          <View style={[s.iconCircle, isForce && { backgroundColor: '#FEF2F2' }]}>
            <Ionicons
              name={isForce ? 'alert-circle' : 'arrow-up-circle'}
              size={48}
              color={isForce ? '#DC2626' : '#059669'}
            />
          </View>

          {/* Title */}
          <Text style={s.title}>
            {isForce ? 'Update Required' : 'New Version Available'}
          </Text>

          {/* Version */}
          <View style={s.versionBadge}>
            <Text style={s.versionText}>v{updateData.latest}</Text>
          </View>

          {/* Description */}
          {updateData.description ? (
            <Text style={s.description}>{updateData.description}</Text>
          ) : null}

          {/* Features List */}
          {features.length > 0 && (
            <View style={s.featuresBox}>
              <Text style={s.featuresTitle}>What's New</Text>
              {features.map((f, i) => (
                <View key={i} style={s.featureRow}>
                  <Ionicons name="checkmark-circle" size={16} color="#059669" />
                  <Text style={s.featureText}>{f}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Force Warning */}
          {isForce && (
            <View style={s.forceWarning}>
              <Ionicons name="warning" size={16} color="#DC2626" />
              <Text style={s.forceWarningText}>
                This update is required to continue using Sarthi
              </Text>
            </View>
          )}

          {/* Update Button → Opens Play Store */}
          <TouchableOpacity style={s.updateBtn} onPress={openStore} activeOpacity={0.8}>
            <Ionicons name="logo-google-playstore" size={18} color="#FFFFFF" />
            <Text style={s.updateBtnText}>Update on Play Store</Text>
          </TouchableOpacity>

          {/* Dismiss (only for optional mode) */}
          {!isForce && (
            <TouchableOpacity
              style={s.dismissBtn}
              onPress={() => setVisible(false)}
              activeOpacity={0.7}
            >
              <Text style={s.dismissBtnText}>Not Now</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    paddingHorizontal: 24,
    paddingVertical: 28,
    width: '100%',
    maxWidth: 340,
    alignItems: 'center',
  },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#ECFDF5',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: '900',
    color: '#111827',
    textAlign: 'center',
    marginBottom: 8,
  },
  versionBadge: {
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 14,
    paddingVertical: 4,
    borderRadius: 20,
    marginBottom: 16,
  },
  versionText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#059669',
  },
  description: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 16,
  },
  featuresBox: {
    backgroundColor: '#F9FAFB',
    borderRadius: 14,
    padding: 14,
    width: '100%',
    marginBottom: 16,
  },
  featuresTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 10,
    letterSpacing: 0.3,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  featureText: {
    fontSize: 13,
    color: '#374151',
    flex: 1,
  },
  forceWarning: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FEF2F2',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    width: '100%',
    marginBottom: 16,
  },
  forceWarningText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#DC2626',
    flex: 1,
  },
  updateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#059669',
    paddingVertical: 14,
    borderRadius: 14,
    width: '100%',
    marginBottom: 8,
  },
  updateBtnText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  dismissBtn: {
    paddingVertical: 12,
    width: '100%',
    alignItems: 'center',
  },
  dismissBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#9CA3AF',
  },
});