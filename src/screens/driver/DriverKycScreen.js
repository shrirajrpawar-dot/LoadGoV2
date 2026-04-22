import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView, Alert, ActivityIndicator, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { doc, onSnapshot, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../../firebase';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { useAuth } from '../../contexts/AuthContext';
import { useAppSettings } from '../../hooks/useAppSettings';

// This will be replaced by settings.vehicles from admin
const DEFAULT_VEHICLES = [
  { id: 'bike', label: '🏍️ Bike' },
  { id: '3wheeler', label: '🛺 3 Wheeler' },
  { id: 'chota_hatti', label: '🚛 Chota Hatti' },
  { id: 'tempo', label: '🚚 Tempo' },
];

export default function DriverKycScreen() {
  const { user, driverDoc } = useAuth();
  const { settings } = useAppSettings(); // ← Get settings from Firestore
  const vehicles = settings.vehicles?.map((v) => ({ id: v.id, label: `${v.icon} ${v.label}` })) || DEFAULT_VEHICLES;
  const [fullName, setFullName] = useState('');
  const [aadharNum, setAadharNum] = useState('');
  const [licenseNum, setLicenseNum] = useState('');
  const [vehicleType, setVehicleType] = useState('bike');
  const [vehicleModel, setVehicleModel] = useState('');
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [aadharPhoto, setAadharPhoto] = useState(null);
  const [licensePhoto, setLicensePhoto] = useState(null);
  const [rcPhoto, setRcPhoto] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');

  useEffect(() => {
    if (!user?.uid) return;
    const unsub = onSnapshot(doc(db, 'drivers', user.uid), (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        setFullName(data.kyc?.fullName || '');
        setAadharNum(data.kyc?.aadharNumber || '');
        setLicenseNum(data.kyc?.licenseNumber || '');
        setVehicleType(data.vehicle?.type || 'bike');
        setVehicleModel(data.vehicle?.model || '');
        setVehicleNumber(data.vehicle?.number || '');
        // Load URLs from Firestore
        if (data.kyc?.aadharPhoto) setAadharPhoto(data.kyc.aadharPhoto);
        if (data.kyc?.licensePhoto) setLicensePhoto(data.kyc.licensePhoto);
        if (data.kyc?.rcPhoto) setRcPhoto(data.kyc.rcPhoto);
      }
    });
    return () => unsub();
  }, [user?.uid]);

  // Upload image to Firebase Storage and get download URL
  const uploadImageToStorage = async (imageUri, docType) => {
    try {
      setUploadProgress(`Uploading ${docType}...`);
      const storage = getStorage();
      const filename = `kyc/${user.uid}/${docType}_${Date.now()}.jpg`;
      const storageRef = ref(storage, filename);

      // Convert Expo URI to blob
      let response;
      try {
        response = await fetch(imageUri);
      } catch (e) {
        throw new Error(`Failed to read image: ${e.message}`);
      }

      if (!response.ok) {
        throw new Error(`Failed to fetch image: ${response.status}`);
      }

      const blob = await response.blob();

      // Upload to Storage
      await uploadBytes(storageRef, blob);

      // Get download URL
      const downloadURL = await getDownloadURL(storageRef);
      setUploadProgress('');
      return downloadURL;
    } catch (error) {
      console.error('Upload error:', error);
      Alert.alert('Upload Error', error.message);
      setUploadProgress('');
      return null;
    }
  };

  const handleUploadDoc = async (setPhoto, docType) => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.7,
    });

    if (!result.canceled && result.assets?.[0]) {
      const uri = result.assets[0].uri;
      // Show local preview immediately
      setPhoto(uri);
    }
  };

  const handleSubmit = async () => {
    if (!fullName.trim()) { Alert.alert('Required', 'Enter full name'); return; }
    if (!aadharNum.trim() || aadharNum.length !== 12) { Alert.alert('Required', 'Enter valid 12-digit Aadhar'); return; }
    if (!licenseNum.trim()) { Alert.alert('Required', 'Enter license number'); return; }
    if (!vehicleModel.trim()) { Alert.alert('Required', 'Enter vehicle model'); return; }
    if (!vehicleNumber.trim()) { Alert.alert('Required', 'Enter vehicle number'); return; }
    if (!aadharPhoto) { Alert.alert('Required', 'Upload Aadhar photo'); return; }
    if (!licensePhoto) { Alert.alert('Required', 'Upload license photo'); return; }
    if (!rcPhoto) { Alert.alert('Required', 'Upload RC photo'); return; }

    setUploading(true);
    try {
      // Upload all 3 images to Firebase Storage (only if they're local URIs, not already URLs)
      let aadharUrl = aadharPhoto;
      let licenseUrl = licensePhoto;
      let rcUrl = rcPhoto;

      if (!aadharPhoto.startsWith('https')) {
        setUploadProgress('Uploading Aadhar photo...');
        aadharUrl = await uploadImageToStorage(aadharPhoto, 'aadhar');
        if (!aadharUrl) throw new Error('Failed to upload Aadhar photo');
      }

      if (!licensePhoto.startsWith('https')) {
        setUploadProgress('Uploading License photo...');
        licenseUrl = await uploadImageToStorage(licensePhoto, 'license');
        if (!licenseUrl) throw new Error('Failed to upload License photo');
      }

      if (!rcPhoto.startsWith('https')) {
        setUploadProgress('Uploading RC photo...');
        rcUrl = await uploadImageToStorage(rcPhoto, 'rc');
        if (!rcUrl) throw new Error('Failed to upload RC photo');
      }

      // Save to Firestore with download URLs
      setUploadProgress('Saving KYC...');
      await updateDoc(doc(db, 'drivers', user.uid), {
        'kyc.fullName': fullName,
        'kyc.aadharNumber': aadharNum,
        'kyc.licenseNumber': licenseNum,
        'kyc.aadharPhoto': aadharUrl,
        'kyc.licensePhoto': licenseUrl,
        'kyc.rcPhoto': rcUrl,
        'kyc.status': 'pending',
        'kyc.submittedAt': serverTimestamp(),
        'vehicle.type': vehicleType,
        'vehicle.label': vehicles.find(v => v.id === vehicleType)?.label || vehicleType,
        'vehicle.model': vehicleModel,
        'vehicle.number': vehicleNumber,
      });

      setUploadProgress('');
      Alert.alert('✅ KYC Submitted!', 'Admin will review and approve soon. Check back in 24 hours.');
    } catch (error) {
      setUploadProgress('');
      Alert.alert('Error', error.message);
    } finally {
      setUploading(false);
    }
  };

  const kycStatus = driverDoc?.kyc?.status || 'not_started';
  const isApproved = kycStatus === 'approved';
  const isPending = kycStatus === 'pending';
  const isRejected = kycStatus === 'rejected';
  const submitDisabled = uploading || isPending || isApproved;

  return (
    <SafeAreaView style={st.container}>
      <ScrollView contentContainerStyle={st.scroll} keyboardShouldPersistTaps="handled">
        <Text style={st.title}>📋 KYC Verification</Text>

        {/* Status Banner */}
        {isApproved && (
          <View style={[st.banner, { backgroundColor: '#ECFDF5', borderColor: '#10B981' }]}>
            <Text style={{ fontSize: 24, marginBottom: 8 }}>✅</Text>
            <Text style={{ fontSize: 16, fontWeight: '700', color: '#065F46' }}>KYC Approved!</Text>
            <Text style={{ fontSize: 13, color: '#047857', marginTop: 4 }}>You can now go online and accept bookings</Text>
          </View>
        )}

        {isPending && (
          <View style={[st.banner, { backgroundColor: '#FEF3C7', borderColor: '#F59E0B' }]}>
            <Text style={{ fontSize: 24, marginBottom: 8 }}>⏳</Text>
            <Text style={{ fontSize: 16, fontWeight: '700', color: '#92400E' }}>Under Review</Text>
            <Text style={{ fontSize: 13, color: '#b45309', marginTop: 4 }}>Admin is reviewing your documents. Check back in 24 hours.</Text>
          </View>
        )}

        {isRejected && (
          <View style={[st.banner, { backgroundColor: '#FEE2E2', borderColor: '#EF4444' }]}>
            <Text style={{ fontSize: 24, marginBottom: 8 }}>❌</Text>
            <Text style={{ fontSize: 16, fontWeight: '700', color: '#991B1B' }}>KYC Rejected</Text>
            <Text style={{ fontSize: 13, color: '#7F1D1D', marginTop: 4 }}>
              Reason: {driverDoc?.kyc?.rejectionReason || 'Please contact support'}
            </Text>
            <Text style={{ fontSize: 13, color: '#7F1D1D', marginTop: 8 }}>Resubmit your documents below ↓</Text>
          </View>
        )}

        {/* Form */}
        <View style={st.section}>
          <Text style={st.sectionTitle}>👤 Personal Information</Text>
          <Input label="Full Name *" value={fullName} onChangeText={setFullName} placeholder="Your full name" editable={!isApproved} />
          <Input label="Aadhar Number *" value={aadharNum} onChangeText={setAadharNum} placeholder="12-digit number" keyboardType="numeric" maxLength={12} editable={!isApproved} />
          <Input label="Driving License *" value={licenseNum} onChangeText={setLicenseNum} placeholder="License number" editable={!isApproved} />
        </View>

        <View style={st.section}>
          <Text style={st.sectionTitle}>🚗 Vehicle Details</Text>
          <Text style={st.label}>Vehicle Type *</Text>
          <View style={st.vehicleGrid}>
            {vehicles.map((v) => (
              <TouchableOpacity
                key={v.id}
                style={[st.vehicleBtn, vehicleType === v.id && st.vehicleBtnActive]}
                onPress={() => setVehicleType(v.id)}
                disabled={isApproved}
              >
                <Text style={st.vehicleLabel}>{v.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Input label="Vehicle Model *" value={vehicleModel} onChangeText={setVehicleModel} placeholder="e.g. Honda CB 200" editable={!isApproved} />
          <Input label="Vehicle Number *" value={vehicleNumber} onChangeText={setVehicleNumber} placeholder="e.g. MH01AB1234" editable={!isApproved} />
        </View>

        <View style={st.section}>
          <Text style={st.sectionTitle}>📸 Upload Documents</Text>
          <Text style={st.desc}>Upload clear photos of all 3 documents. Make sure text is readable.</Text>

          <DocBtn
            label="Aadhar Card"
            photo={aadharPhoto}
            onPress={() => handleUploadDoc(setAadharPhoto, 'Aadhar')}
            disabled={isApproved}
          />
          <DocBtn
            label="Driving License"
            photo={licensePhoto}
            onPress={() => handleUploadDoc(setLicensePhoto, 'License')}
            disabled={isApproved}
          />
          <DocBtn
            label="Vehicle RC"
            photo={rcPhoto}
            onPress={() => handleUploadDoc(setRcPhoto, 'RC')}
            disabled={isApproved}
          />
        </View>

        {/* Submit Button */}
        {!isApproved && (
          <TouchableOpacity
            style={[st.submitBtn, submitDisabled && st.submitBtnDisabled]}
            onPress={handleSubmit}
            disabled={submitDisabled}
          >
            {uploading ? (
              <>
                <ActivityIndicator color="#fff" style={{ marginRight: 8 }} />
                <Text style={st.submitBtnText}>{uploadProgress || 'Submitting...'}</Text>
              </>
            ) : (
              <Text style={st.submitBtnText}>✅ Submit KYC</Text>
            )}
          </TouchableOpacity>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Input({ label, value, onChangeText, placeholder, keyboardType = 'default', maxLength, editable = true }) {
  return (
    <View style={st.inputGroup}>
      <Text style={st.label}>{label}</Text>
      <TextInput
        style={[st.input, !editable && { backgroundColor: '#F3F4F6', color: '#9CA3AF' }]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        keyboardType={keyboardType}
        maxLength={maxLength}
        editable={editable}
      />
    </View>
  );
}

function DocBtn({ label, photo, onPress, disabled }) {
  const isUploaded = photo && photo.startsWith('https');
  const isSelected = photo && !photo.startsWith('https');

  return (
    <TouchableOpacity
      style={[st.docBtn, disabled && st.docBtnDisabled]}
      onPress={onPress}
      disabled={disabled}
    >
      {isUploaded ? (
        <>
          <Image source={{ uri: photo }} style={st.docThumb} />
          <View style={st.docBtnText}>
            <Text style={{ color: '#10B981', fontWeight: '700' }}>✅ {label} Uploaded</Text>
            <Text style={{ color: '#6B7280', fontSize: 12 }}>Tap to change</Text>
          </View>
        </>
      ) : isSelected ? (
        <>
          <Text style={{ fontSize: 32 }}>⏳</Text>
          <View style={st.docBtnText}>
            <Text style={{ color: '#F59E0B', fontWeight: '700' }}>📸 {label} Selected</Text>
            <Text style={{ color: '#6B7280', fontSize: 12 }}>Will upload on submit</Text>
          </View>
        </>
      ) : (
        <>
          <Text style={{ fontSize: 32 }}>📸</Text>
          <Text style={[st.docBtnText, { color: '#6B7280' }]}>Tap to upload {label}</Text>
        </>
      )}
    </TouchableOpacity>
  );
}

const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  scroll: { padding: 20, paddingBottom: 40 },
  title: { fontSize: 24, fontWeight: '700', color: '#1F2937', marginBottom: 20 },
  banner: { borderWidth: 2, borderRadius: 12, padding: 16, marginBottom: 20, alignItems: 'center' },
  section: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: '#E5E7EB' },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#1F2937', marginBottom: 12 },
  desc: { fontSize: 13, color: '#6B7280', marginBottom: 12 },
  label: { fontSize: 12, fontWeight: '700', color: '#6B7280', marginBottom: 8, letterSpacing: 0.5 },
  inputGroup: { marginBottom: 14 },
  input: { backgroundColor: '#F9FAFB', borderWidth: 1.5, borderColor: '#E5E7EB', borderRadius: 10, padding: 12, fontSize: 14 },
  vehicleGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  vehicleBtn: { flex: 1, minWidth: '45%', paddingVertical: 10, paddingHorizontal: 12, borderRadius: 8, borderWidth: 2, borderColor: '#E5E7EB', backgroundColor: '#fff', alignItems: 'center' },
  vehicleBtnActive: { borderColor: '#10B981', backgroundColor: '#10B98115' },
  vehicleLabel: { fontSize: 13, fontWeight: '600', color: '#1F2937' },
  docBtn: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 12, borderWidth: 2, borderColor: '#E5E7EB', borderRadius: 10, marginBottom: 10, backgroundColor: '#fff' },
  docBtnDisabled: { opacity: 0.5 },
  docThumb: { width: 60, height: 60, borderRadius: 8, backgroundColor: '#F3F4F6' },
  docBtnText: { flex: 1 },
  submitBtn: { backgroundColor: '#10B981', paddingVertical: 16, borderRadius: 12, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', marginTop: 20 },
  submitBtnDisabled: { opacity: 0.5 },
  submitBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
