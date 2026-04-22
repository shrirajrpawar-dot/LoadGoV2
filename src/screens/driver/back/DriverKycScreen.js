import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  ScrollView, Alert, ActivityIndicator, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import * as ImagePicker from 'expo-image-picker';

const VEHICLE_TYPES = [
  { id: 'bike', label: 'Bike', icon: '🏍️' },
  { id: '3wheeler', label: '3 Wheeler', icon: '🛺' },
  { id: 'chota_hatti', label: 'Chota Hatti', icon: '🚛' },
  { id: 'tempo', label: 'Tempo', icon: '🚚' },
];

export default function DriverKycScreen() {
  const { user, driverDoc } = useAuth();
  const kycStatus = driverDoc?.kyc?.status || 'not_started';

  const [fullName, setFullName] = useState('');
  const [aadharNumber, setAadharNumber] = useState('');
  const [licenseNumber, setLicenseNumber] = useState('');
  const [vehicleType, setVehicleType] = useState('bike');
  const [vehicleModel, setVehicleModel] = useState('');
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [aadharPhoto, setAadharPhoto] = useState(null);
  const [licensePhoto, setLicensePhoto] = useState(null);
  const [rcPhoto, setRcPhoto] = useState(null);
  const [loading, setLoading] = useState(false);

  // Sync from driverDoc
  useEffect(() => {
    if (driverDoc?.kyc) {
      setFullName(driverDoc.kyc.fullName || '');
      setAadharNumber(driverDoc.kyc.aadharNumber || '');
      setLicenseNumber(driverDoc.kyc.licenseNumber || '');
      setAadharPhoto(driverDoc.kyc.aadharPhoto || null);
      setLicensePhoto(driverDoc.kyc.licensePhoto || null);
      setRcPhoto(driverDoc.kyc.rcPhoto || null);
    }
    if (driverDoc?.vehicle) {
      setVehicleType(driverDoc.vehicle.type || 'bike');
      setVehicleModel(driverDoc.vehicle.model || '');
      setVehicleNumber(driverDoc.vehicle.number || '');
    }
  }, [driverDoc]);

  const handleUploadDoc = (setter, label) => {
    Alert.alert(`Upload ${label}`, 'Choose option', [
      {
        text: '📷 Camera', onPress: async () => {
          const { status } = await ImagePicker.requestCameraPermissionsAsync();
          if (status !== 'granted') { Alert.alert('Permission needed'); return; }
          const r = await ImagePicker.launchCameraAsync({ quality: 0.7, allowsEditing: true });
          if (!r.canceled && r.assets?.[0]) setter(r.assets[0].uri);
        }
      },
      {
        text: '🖼️ Gallery', onPress: async () => {
          const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (status !== 'granted') { Alert.alert('Permission needed'); return; }
          const r = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.7, allowsEditing: true,
          });
          if (!r.canceled && r.assets?.[0]) setter(r.assets[0].uri);
        }
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const handleSubmit = async () => {
    if (!fullName.trim()) { Alert.alert('Required', 'Enter full name'); return; }
    if (aadharNumber.length !== 12) { Alert.alert('Required', 'Enter valid 12-digit Aadhar'); return; }
    if (!licenseNumber.trim()) { Alert.alert('Required', 'Enter license number'); return; }
    if (!vehicleModel.trim()) { Alert.alert('Required', 'Enter vehicle model'); return; }
    if (!vehicleNumber.trim()) { Alert.alert('Required', 'Enter vehicle number'); return; }
    if (!aadharPhoto) { Alert.alert('Required', 'Upload Aadhar photo'); return; }
    if (!licensePhoto) { Alert.alert('Required', 'Upload license photo'); return; }
    if (!rcPhoto) { Alert.alert('Required', 'Upload RC photo'); return; }

    setLoading(true);
    try {
      const veh = VEHICLE_TYPES.find((v) => v.id === vehicleType);
      await updateDoc(doc(db, 'drivers', user.uid), {
        name: fullName.trim(),
        kyc: {
          status: 'pending',
          fullName: fullName.trim(),
          aadharNumber: aadharNumber.trim(),
          licenseNumber: licenseNumber.trim(),
          aadharPhoto, licensePhoto, rcPhoto,
          submittedAt: new Date().toISOString(),
        },
        vehicle: {
          type: vehicleType,
          label: veh?.label || vehicleType,
          model: vehicleModel.trim(),
          number: vehicleNumber.trim().toUpperCase(),
        },
      });
      Alert.alert('✅ Submitted!', 'Your KYC is under review.\n\n🧪 For testing: In Firebase Console, change kyc.status to "approved".');
    } catch (e) { Alert.alert('Error', e.message); }
    setLoading(false);
  };

  // ===== APPROVED =====
  if (kycStatus === 'approved') {
    return (
      <SafeAreaView style={st.container}>
        <ScrollView contentContainerStyle={st.scroll}>
          <Text style={st.title}>📋 KYC Verification</Text>
          <View style={st.statusCard}>
            <Text style={{ fontSize: 56 }}>✅</Text>
            <Text style={st.statusTitle}>KYC Approved</Text>
            <Text style={st.statusDesc}>You can now accept bookings!</Text>
          </View>
          <View style={st.infoCard}>
            <Row label="Name" value={driverDoc?.kyc?.fullName} />
            <Row label="Aadhar" value={driverDoc?.kyc?.aadharNumber?.replace(/(\d{4})/g, '$1 ')} />
            <Row label="License" value={driverDoc?.kyc?.licenseNumber} />
            <Row label="Vehicle" value={`${driverDoc?.vehicle?.label} — ${driverDoc?.vehicle?.model}`} />
            <Row label="Number" value={driverDoc?.vehicle?.number} />
          </View>
          {driverDoc?.kyc?.aadharPhoto && (
            <View style={st.docPreviewCard}>
              <Text style={st.docPreviewLabel}>📄 Uploaded Documents</Text>
              <View style={st.docRow}>
                {driverDoc.kyc.aadharPhoto && <Image source={{ uri: driverDoc.kyc.aadharPhoto }} style={st.docThumb} />}
                {driverDoc.kyc.licensePhoto && <Image source={{ uri: driverDoc.kyc.licensePhoto }} style={st.docThumb} />}
                {driverDoc.kyc.rcPhoto && <Image source={{ uri: driverDoc.kyc.rcPhoto }} style={st.docThumb} />}
              </View>
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ===== PENDING =====
  if (kycStatus === 'pending') {
    return (
      <SafeAreaView style={st.container}>
        <ScrollView contentContainerStyle={st.scroll}>
          <Text style={st.title}>📋 KYC Verification</Text>
          <View style={st.statusCard}>
            <Text style={{ fontSize: 56 }}>⏳</Text>
            <Text style={st.statusTitle}>Under Review</Text>
            <Text style={st.statusDesc}>Your documents are being verified. This usually takes 1-2 hours.</Text>
          </View>
          <Text style={st.testTip}>
            🧪 For testing: Firebase Console → Firestore → drivers → your UID → kyc.status → change to "approved"
          </Text>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ===== FORM (not_started or rejected) =====
  return (
    <SafeAreaView style={st.container}>
      <ScrollView contentContainerStyle={st.scroll} keyboardShouldPersistTaps="handled">
        <Text style={st.title}>📋 KYC Verification</Text>

        {kycStatus === 'rejected' && (
          <View style={st.rejectedBox}>
            <Text style={st.rejectedTitle}>❌ KYC Rejected</Text>
            <Text style={st.rejectedDesc}>{driverDoc?.kyc?.rejectionReason || 'Please resubmit with correct information'}</Text>
          </View>
        )}

        <Text style={st.section}>PERSONAL DETAILS</Text>

        <Text style={st.label}>Full Name *</Text>
        <TextInput style={st.input} value={fullName} onChangeText={setFullName} placeholder="Enter your full name" />

        <Text style={st.label}>Aadhar Number * ({aadharNumber.length}/12)</Text>
        <TextInput style={st.input} value={aadharNumber}
          onChangeText={(t) => setAadharNumber(t.replace(/[^0-9]/g, '').slice(0, 12))}
          placeholder="12-digit Aadhar number" keyboardType="numeric" maxLength={12} />

        <Text style={st.label}>License Number *</Text>
        <TextInput style={st.input} value={licenseNumber} onChangeText={setLicenseNumber}
          placeholder="e.g., MH-0420180012345" autoCapitalize="characters" />

        <Text style={st.section}>VEHICLE DETAILS</Text>

        <Text style={st.label}>Vehicle Type *</Text>
        <View style={st.vTypeRow}>
          {VEHICLE_TYPES.map((v) => (
            <TouchableOpacity key={v.id}
              style={[st.vTypeBtn, vehicleType === v.id && st.vTypeBtnActive]}
              onPress={() => setVehicleType(v.id)}>
              <Text style={{ fontSize: 20 }}>{v.icon}</Text>
              <Text style={[st.vTypeName, vehicleType === v.id && { color: '#10B981' }]}>{v.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={st.label}>Vehicle Model *</Text>
        <TextInput style={st.input} value={vehicleModel} onChangeText={setVehicleModel}
          placeholder="e.g., Honda Activa, Tata Ace" />

        <Text style={st.label}>Vehicle Number *</Text>
        <TextInput style={st.input} value={vehicleNumber} onChangeText={setVehicleNumber}
          placeholder="e.g., MH 02 AB 1234" autoCapitalize="characters" />

        <Text style={st.section}>DOCUMENT UPLOADS</Text>

        <DocBtn label="Aadhar Card" photo={aadharPhoto} onPress={() => handleUploadDoc(setAadharPhoto, 'Aadhar Card')} />
        <DocBtn label="Driving License" photo={licensePhoto} onPress={() => handleUploadDoc(setLicensePhoto, 'Driving License')} />
        <DocBtn label="Vehicle RC" photo={rcPhoto} onPress={() => handleUploadDoc(setRcPhoto, 'Vehicle RC')} />

        <TouchableOpacity style={[st.submitBtn, loading && { opacity: 0.5 }]} onPress={handleSubmit} disabled={loading}>
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={st.submitBtnText}>Submit KYC</Text>}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ label, value }) {
  return (
    <View style={st.infoRow}>
      <Text style={st.infoLabel}>{label}</Text>
      <Text style={st.infoValue}>{value || 'N/A'}</Text>
    </View>
  );
}

function DocBtn({ label, photo, onPress }) {
  return (
    <TouchableOpacity style={st.docBtn} onPress={onPress}>
      {photo ? (
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Image source={{ uri: photo }} style={{ width: 48, height: 48, borderRadius: 8, marginRight: 12 }} />
          <View style={{ flex: 1 }}>
            <Text style={st.docLabel}>{label}</Text>
            <Text style={{ fontSize: 12, color: '#10B981' }}>✅ Uploaded — Tap to change</Text>
          </View>
        </View>
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text style={{ fontSize: 24, marginRight: 12 }}>📷</Text>
          <View style={{ flex: 1 }}>
            <Text style={st.docLabel}>{label}</Text>
            <Text style={{ fontSize: 12, color: '#6B7280' }}>Tap to upload</Text>
          </View>
          <Text style={{ color: '#10B981', fontWeight: '700' }}>Upload</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  scroll: { padding: 20, paddingBottom: 60 },
  title: { fontSize: 22, fontWeight: '700', color: '#1F2937', marginBottom: 16 },
  statusCard: {
    backgroundColor: '#fff', borderRadius: 16, padding: 32, alignItems: 'center',
    borderWidth: 1, borderColor: '#E5E7EB', marginBottom: 16,
  },
  statusTitle: { fontSize: 22, fontWeight: '700', color: '#1F2937', marginTop: 12 },
  statusDesc: { fontSize: 14, color: '#6B7280', marginTop: 8, textAlign: 'center' },
  infoCard: { backgroundColor: '#fff', borderRadius: 12, padding: 16, borderWidth: 1, borderColor: '#E5E7EB' },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  infoLabel: { fontSize: 13, color: '#6B7280' },
  infoValue: { fontSize: 13, fontWeight: '600', color: '#1F2937', textAlign: 'right', flex: 1, marginLeft: 12 },
  docPreviewCard: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginTop: 16, borderWidth: 1, borderColor: '#E5E7EB' },
  docPreviewLabel: { fontSize: 14, fontWeight: '600', color: '#1F2937', marginBottom: 12 },
  docRow: { flexDirection: 'row', gap: 8 },
  docThumb: { width: 80, height: 60, borderRadius: 8, backgroundColor: '#F3F4F6' },
  testTip: { fontSize: 12, color: '#6B7280', fontStyle: 'italic', textAlign: 'center', marginTop: 16, lineHeight: 18 },
  rejectedBox: { backgroundColor: '#FEF2F2', borderWidth: 1, borderColor: '#EF4444', borderRadius: 12, padding: 16, marginBottom: 16 },
  rejectedTitle: { fontSize: 16, fontWeight: '700', color: '#EF4444' },
  rejectedDesc: { fontSize: 13, color: '#991B1B', marginTop: 4 },
  section: { fontSize: 12, fontWeight: '800', color: '#10B981', letterSpacing: 1, marginTop: 24, marginBottom: 8 },
  label: { fontSize: 12, fontWeight: '600', color: '#6B7280', marginBottom: 6, marginTop: 12 },
  input: { backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#E5E7EB', borderRadius: 10, padding: 12, fontSize: 15, color: '#1F2937' },
  vTypeRow: { flexDirection: 'row', gap: 8 },
  vTypeBtn: { flex: 1, backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#E5E7EB', borderRadius: 10, padding: 10, alignItems: 'center' },
  vTypeBtnActive: { borderColor: '#10B981', backgroundColor: '#10B98110' },
  vTypeName: { fontSize: 10, fontWeight: '600', color: '#6B7280', marginTop: 4 },
  docBtn: { backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#E5E7EB', borderStyle: 'dashed', borderRadius: 12, padding: 14, marginBottom: 12 },
  docLabel: { fontSize: 14, fontWeight: '600', color: '#1F2937' },
  submitBtn: { backgroundColor: '#10B981', borderRadius: 12, paddingVertical: 16, alignItems: 'center', marginTop: 24 },
  submitBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
