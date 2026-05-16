import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView, Alert, ActivityIndicator, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { doc, onSnapshot, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../../firebase';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { useAuth } from '../../contexts/AuthContext';
import { useAppSettings } from '../../hooks/useAppSettings';

const DEFAULT_VEHICLES = [
  { id: 'bike', label: '🏍️ Bike' },
  { id: '3wheeler', label: '🛺 3 Wheeler' },
  { id: 'chota_hatti', label: '🚛 Chota Hatti' },
  { id: 'tempo', label: '🚚 Tempo' },
];

export default function DriverKycScreen() {
  const { user, driverDoc } = useAuth();
  const { settings } = useAppSettings();
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
  const [editMode, setEditMode] = useState(false);

  // KYC status
  const kycStatus = driverDoc?.kyc?.status || 'not_started';
  const isApproved = kycStatus === 'approved';
  const isPending = kycStatus === 'pending';
  const isRejected = kycStatus === 'rejected';
  const isNotStarted = kycStatus === 'not_started';

  // Can user edit fields?
  const canEdit = isNotStarted || isRejected || editMode;

  // Can user submit?
  const canSubmit = canEdit && !uploading;

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
        if (data.kyc?.aadharPhoto) setAadharPhoto(data.kyc.aadharPhoto);
        if (data.kyc?.licensePhoto) setLicensePhoto(data.kyc.licensePhoto);
        if (data.kyc?.rcPhoto) setRcPhoto(data.kyc.rcPhoto);
      }
    });
    return () => unsub();
  }, [user?.uid]);

  // When KYC status changes away from approved, exit edit mode
  useEffect(() => {
    if (!isApproved) setEditMode(false);
  }, [isApproved]);

  const uploadImageToStorage = async (imageUri, docType) => {
    try {
      setUploadProgress(`Uploading ${docType}...`);
      const storage = getStorage();
      const filename = `kyc/${user.uid}/${docType}_${Date.now()}.jpg`;
      const storageRef = ref(storage, filename);
      const response = await fetch(imageUri);
      if (!response.ok) throw new Error(`Failed to fetch image: ${response.status}`);
      const blob = await response.blob();
      await uploadBytes(storageRef, blob);
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
      setPhoto(result.assets[0].uri);
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
      let aadharUrl = aadharPhoto;
      let licenseUrl = licensePhoto;
      let rcUrl = rcPhoto;

      if (!aadharPhoto.startsWith('https')) {
        aadharUrl = await uploadImageToStorage(aadharPhoto, 'aadhar');
        if (!aadharUrl) throw new Error('Failed to upload Aadhar photo');
      }
      if (!licensePhoto.startsWith('https')) {
        licenseUrl = await uploadImageToStorage(licensePhoto, 'license');
        if (!licenseUrl) throw new Error('Failed to upload License photo');
      }
      if (!rcPhoto.startsWith('https')) {
        rcUrl = await uploadImageToStorage(rcPhoto, 'rc');
        if (!rcUrl) throw new Error('Failed to upload RC photo');
      }

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
        status: 'offline',
      });

      setUploadProgress('');
      setEditMode(false);
      Alert.alert(
        '✅ KYC Submitted!',
        editMode
          ? 'Your updated KYC is under review. You have been set offline until re-approved.'
          : 'Admin will review and approve soon. You will be notified.'
      );
    } catch (error) {
      setUploadProgress('');
      Alert.alert('Error', error.message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <SafeAreaView style={st.container}>
      <ScrollView contentContainerStyle={st.scroll} keyboardShouldPersistTaps="handled">
        <Text style={st.title}>📋 KYC Verification</Text>

        {/* ── STATUS BANNERS ── */}

        {isApproved && !editMode && (
          <View style={[st.banner, { backgroundColor: '#ECFDF5', borderColor: '#10B981' }]}>
            <Text style={{ fontSize: 24, marginBottom: 8 }}>✅</Text>
            <Text style={st.bannerTitle}>KYC Approved!</Text>
            <Text style={st.bannerSub}>You can now go online and accept bookings</Text>
            <TouchableOpacity style={st.editBtn} onPress={() => setEditMode(true)}>
              <Text style={st.editBtnText}>✏️ Edit KYC Details</Text>
            </TouchableOpacity>
          </View>
        )}

        {isApproved && editMode && (
          <View style={[st.banner, { backgroundColor: '#FEF3C7', borderColor: '#F59E0B' }]}>
            <Text style={{ fontSize: 24, marginBottom: 8 }}>✏️</Text>
            <Text style={st.bannerTitle}>Editing KYC</Text>
            <Text style={st.bannerSub}>After saving, KYC goes back to pending and you'll be set offline until re-approved.</Text>
            <TouchableOpacity style={[st.editBtn, { backgroundColor: '#6B7280' }]} onPress={() => setEditMode(false)}>
              <Text style={st.editBtnText}>Cancel Edit</Text>
            </TouchableOpacity>
          </View>
        )}

        {isPending && (
          <View style={[st.banner, { backgroundColor: '#FEF3C7', borderColor: '#F59E0B' }]}>
            <Text style={{ fontSize: 24, marginBottom: 8 }}>⏳</Text>
            <Text style={st.bannerTitle}>Under Review</Text>
            <Text style={st.bannerSub}>Admin is reviewing your documents. You'll be notified once approved.</Text>
          </View>
        )}

        {isRejected && (
          <View style={[st.banner, { backgroundColor: '#FEE2E2', borderColor: '#EF4444' }]}>
            <Text style={{ fontSize: 24, marginBottom: 8 }}>❌</Text>
            <Text style={st.bannerTitle}>KYC Rejected</Text>
            <Text style={st.bannerSub}>
              Reason: {driverDoc?.kyc?.rejectionReason || 'Please contact support'}
            </Text>
            <Text style={[st.bannerSub, { marginTop: 8 }]}>Please fix and resubmit below ↓</Text>
          </View>
        )}

        {/* ── FORM FIELDS ── */}

        <View style={st.section}>
          <Text style={st.sectionTitle}>👤 Personal Information</Text>
          <Input label="Full Name *" value={fullName} onChangeText={setFullName} placeholder="Your full name" editable={canEdit} />
          <Input label="Aadhar Number *" value={aadharNum} onChangeText={setAadharNum} placeholder="12-digit number" keyboardType="numeric" maxLength={12} editable={canEdit} />
          <Input label="Driving License *" value={licenseNum} onChangeText={setLicenseNum} placeholder="License number" editable={canEdit} />
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
                disabled={!canEdit}
              >
                <Text style={st.vehicleLabel}>{v.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Input label="Vehicle Model *" value={vehicleModel} onChangeText={setVehicleModel} placeholder="e.g. Honda CB 200" editable={canEdit} />
          <Input label="Vehicle Number *" value={vehicleNumber} onChangeText={setVehicleNumber} placeholder="e.g. MH01AB1234" editable={canEdit} />
        </View>

        <View style={st.section}>
          <Text style={st.sectionTitle}>📸 Upload Documents</Text>
          <Text style={st.desc}>Upload clear photos of all 3 documents. Make sure text is readable.</Text>
          <DocBtn label="Aadhar Card" photo={aadharPhoto} onPress={() => handleUploadDoc(setAadharPhoto, 'Aadhar')} disabled={!canEdit} />
          <DocBtn label="Driving License" photo={licensePhoto} onPress={() => handleUploadDoc(setLicensePhoto, 'License')} disabled={!canEdit} />
          <DocBtn label="Vehicle RC" photo={rcPhoto} onPress={() => handleUploadDoc(setRcPhoto, 'RC')} disabled={!canEdit} />
        </View>

        {/* ── SUBMIT BUTTON — only visible when canSubmit ── */}
        {canSubmit && (
          <TouchableOpacity style={st.submitBtn} onPress={handleSubmit} disabled={uploading}>
            {uploading ? (
              <>
                <ActivityIndicator color="#fff" style={{ marginRight: 8 }} />
                <Text style={st.submitBtnText}>{uploadProgress || 'Submitting...'}</Text>
              </>
            ) : (
              <Text style={st.submitBtnText}>
                {editMode ? '💾 Save Changes' : '✅ Submit KYC'}
              </Text>
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
        placeholderTextColor="#9CA3AF"
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
          <View style={st.docBtnTextWrap}>
            <Text style={{ color: '#10B981', fontWeight: '700' }}>✅ {label} Uploaded</Text>
            {!disabled && <Text style={{ color: '#6B7280', fontSize: 12 }}>Tap to change</Text>}
          </View>
        </>
      ) : isSelected ? (
        <>
          <Text style={{ fontSize: 32 }}>⏳</Text>
          <View style={st.docBtnTextWrap}>
            <Text style={{ color: '#F59E0B', fontWeight: '700' }}>📸 {label} Selected</Text>
            <Text style={{ color: '#6B7280', fontSize: 12 }}>Will upload on submit</Text>
          </View>
        </>
      ) : (
        <>
          <Text style={{ fontSize: 32 }}>📸</Text>
          <Text style={{ flex: 1, color: '#6B7280' }}>Tap to upload {label}</Text>
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
  bannerTitle: { fontSize: 16, fontWeight: '700', color: '#1F2937' },
  bannerSub: { fontSize: 13, color: '#6B7280', marginTop: 4, textAlign: 'center' },
  editBtn: { marginTop: 12, backgroundColor: '#111827', paddingVertical: 10, paddingHorizontal: 20, borderRadius: 10 },
  editBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 13 },
  section: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: '#E5E7EB' },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#1F2937', marginBottom: 12 },
  desc: { fontSize: 13, color: '#6B7280', marginBottom: 12 },
  label: { fontSize: 12, fontWeight: '700', color: '#6B7280', marginBottom: 8, letterSpacing: 0.5 },
  inputGroup: { marginBottom: 14 },
  input: { backgroundColor: '#F9FAFB', borderWidth: 1.5, borderColor: '#E5E7EB', borderRadius: 10, padding: 12, fontSize: 14, color: '#111827' },
  vehicleGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  vehicleBtn: { flex: 1, minWidth: '45%', paddingVertical: 10, paddingHorizontal: 12, borderRadius: 8, borderWidth: 2, borderColor: '#E5E7EB', backgroundColor: '#fff', alignItems: 'center' },
  vehicleBtnActive: { borderColor: '#10B981', backgroundColor: '#10B98115' },
  vehicleLabel: { fontSize: 13, fontWeight: '600', color: '#1F2937' },
  docBtn: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 12, borderWidth: 2, borderColor: '#E5E7EB', borderRadius: 10, marginBottom: 10, backgroundColor: '#fff' },
  docBtnDisabled: { opacity: 0.5 },
  docThumb: { width: 60, height: 60, borderRadius: 8, backgroundColor: '#F3F4F6' },
  docBtnTextWrap: { flex: 1 },
  submitBtn: { backgroundColor: '#10B981', paddingVertical: 16, borderRadius: 12, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', marginTop: 20 },
  submitBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});