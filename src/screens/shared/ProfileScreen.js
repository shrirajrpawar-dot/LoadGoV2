import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView, Alert, ActivityIndicator, Image, Animated } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { doc, onSnapshot, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../../firebase';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { useAuth } from '../../contexts/AuthContext';
import { useAppSettings } from '../../hooks/useAppSettings';
import { signOut } from 'firebase/auth';
import { auth } from '../../../firebase';

export default function ProfileScreen() {
  const { user, profile, driverDoc, joinAsDriver } = useAuth();
  const { settings } = useAppSettings();
  const [activeTab, setActiveTab] = useState('profile'); // 'profile' or 'kyc'
  const [isDriver, setIsDriver] = useState(false);
  const [isEditingKyc, setIsEditingKyc] = useState(false);
  
  // KYC states
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

  // Animation states
  const [pulseAnim] = useState(new Animated.Value(1));
  const [rotateAnim] = useState(new Animated.Value(0));

  useEffect(() => {
    if (!user?.uid) return;
    // Check if driver document exists OR if profile mode is driver
    setIsDriver(!!driverDoc || profile?.mode === 'driver');
    
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
  }, [user?.uid, driverDoc, profile?.mode]);

  // Animation for "Under Review" pulse effect
  useEffect(() => {
    if (isPending) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.05,
            duration: 1000,
            useNativeDriver: false,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 1000,
            useNativeDriver: false,
          }),
        ])
      ).start();
    }
  }, [isPending, pulseAnim]);

  // Animation for rotating hourglass
  useEffect(() => {
    if (isPending) {
      Animated.loop(
        Animated.timing(rotateAnim, {
          toValue: 1,
          duration: 2000,
          useNativeDriver: true,
        })
      ).start();
    }
  }, [isPending, rotateAnim]);

  const rotation = rotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

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

  const handleUploadDoc = async (setPhoto) => {
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

  const handleKycSubmit = async () => {
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
      
      // Get vehicle label from either parcel or ride vehicles
      const allVehicles = [
        ...(settings.parcelVehicles || []),
        ...(settings.rideVehicles || [])
      ];
      const vehicleLabel = allVehicles.find(v => v.id === vehicleType)?.label || vehicleType;
      
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
        'vehicle.label': vehicleLabel,
        'vehicle.model': vehicleModel,
        'vehicle.number': vehicleNumber,
      });

      setUploadProgress('');
      Alert.alert('✅ KYC Submitted!', 'Admin will review and approve soon.');
    } catch (error) {
      setUploadProgress('');
      Alert.alert('Error', error.message);
    } finally {
      setUploading(false);
    }
  };

  const handleSignOut = async () => {
    Alert.alert('Sign Out?', 'You will be logged out.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: async () => {
        try {
          await signOut(auth);
        } catch (e) {
          Alert.alert('Error', e.message);
        }
      }}
    ]);
  };

  const handleJoinAsDriver = () => {
    Alert.alert(
      '⚠️ Switch to Driver Mode',
      'You will switch to driver mode and won\'t be able to use the customer profile anymore.\n\nYou can only accept deliveries and manage earnings.\n\nAre you sure?',
      [
        { text: 'Cancel', onPress: () => {}, style: 'cancel' },
        {
          text: 'Yes, Join as Driver',
          onPress: async () => {
            try {
              await joinAsDriver();
              // isDriver will sync automatically from auth context
              Alert.alert('✅ Welcome!', 'Complete your KYC to start accepting bookings');
              // Give time for state to update before switching tab
              setTimeout(() => setActiveTab('kyc'), 500);
            } catch (e) {
              Alert.alert('Error', e.message);
            }
          },
          style: 'destructive'
        }
      ]
    );
  };

  const kycStatus = driverDoc?.kyc?.status || 'not_started';
  const isApproved = kycStatus === 'approved';
  const isPending = kycStatus === 'pending';

  return (
    <SafeAreaView style={st.container}>
      <ScrollView contentContainerStyle={st.scroll}>
        {/* PROFILE TAB */}
        {activeTab === 'profile' && (
          <View>
            <Text style={st.title}>👤 Profile</Text>
            <View style={st.card}>
              <InfoRow label="Name" value={profile?.name} />
              <InfoRow label="Phone" value={profile?.phone} />
              <InfoRow label="Email" value={profile?.email} />
              <InfoRow label="Mode" value={profile?.mode === 'driver' ? '🚗 Driver' : '👥 Customer'} />
            </View>

            {/* Driver Info */}
            {isDriver && driverDoc && (
              <View style={st.card}>
                <Text style={st.cardTitle}>🚗 Driver Status</Text>
                <InfoRow label="KYC Status" value={
                  isApproved ? '✅ Approved' :
                  isPending ? '⏳ Pending' :
                  '❌ Not Started'
                } />
                {driverDoc.vehicle?.label && <InfoRow label="Vehicle" value={driverDoc.vehicle.label} />}
                <InfoRow label="Earnings (Today)" value={`₹${Math.round((driverDoc.earnings?.todayInPaise || 0) / 100)}`} />
                <InfoRow label="Earnings (Total)" value={`₹${Math.round((driverDoc.earnings?.totalInPaise || 0) / 100)}`} />
              </View>
            )}

            {/* Action Buttons - CUSTOMER ONLY */}
            {!isDriver && (
              <View style={st.buttonGroup}>
                <TouchableOpacity style={st.btn} onPress={handleJoinAsDriver}>
                  <Text style={st.btnText}>🚗 Join as Driver</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[st.btn, { backgroundColor: '#EF4444' }]} onPress={handleSignOut}>
                  <Text style={st.btnText}>🚪 Sign Out</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Action Buttons - DRIVER ONLY */}
            {isDriver && (
              <View style={st.buttonGroup}>
                <TouchableOpacity style={[st.btn, { backgroundColor: '#F59E0B' }]} onPress={() => setActiveTab('kyc')}>
                  <Text style={st.btnText}>📋 Update KYC</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[st.btn, { backgroundColor: '#EF4444' }]} onPress={handleSignOut}>
                  <Text style={st.btnText}>🚪 Sign Out</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}

        {/* KYC TAB - DRIVER ONLY */}
        {activeTab === 'kyc' && isDriver && (
          <View>
            <TouchableOpacity 
              onPress={() => setActiveTab('profile')}
              style={{ marginBottom: 16, paddingVertical: 8 }}
            >
              <Text style={{ fontSize: 14, color: '#10B981', fontWeight: '600' }}>← Go to Profile Tab</Text>
            </TouchableOpacity>
            <Text style={st.title}>📋 KYC Verification</Text>

            {/* KYC Status Banner */}
            {isApproved && (
              <View style={[st.banner, { backgroundColor: '#ECFDF5', borderColor: '#10B981' }]}>
                <Text style={{ fontSize: 24, marginBottom: 8 }}>✅</Text>
                <Text style={{ fontSize: 16, fontWeight: '700', color: '#065F46' }}>KYC Approved!</Text>
                <Text style={{ fontSize: 13, color: '#047857', marginTop: 4 }}>You can go online and accept bookings</Text>
              </View>
            )}

            {isPending && (
              <Animated.View style={[st.banner, { backgroundColor: '#FEF3C7', borderColor: '#F59E0B', transform: [{ scale: pulseAnim }] }]}>
                <Animated.Text style={{ fontSize: 24, marginBottom: 8, transform: [{ rotate: rotation }] }}>⏳</Animated.Text>
                <Text style={{ fontSize: 16, fontWeight: '700', color: '#92400E' }}>Under Review</Text>
                <Text style={{ fontSize: 12, color: '#92400E', marginTop: 4 }}>Your KYC is being reviewed by our team</Text>
              </Animated.View>
            )}

            {isApproved && vehicleType === 'bike' && (
              <View style={[st.banner, { backgroundColor: '#EFF6FF', borderColor: '#3B82F6' }]}>
                <Animated.Text style={{ fontSize: 28, marginBottom: 8, transform: [{ rotate: rotation }] }}>🏍️</Animated.Text>
                <Text style={{ fontSize: 16, fontWeight: '700', color: '#1E40AF' }}>Waiting for Bike Requests</Text>
                <Text style={{ fontSize: 12, color: '#1E40AF', marginTop: 4 }}>You're online! Ready to accept rides</Text>
              </View>
            )}

            {isApproved && vehicleType === 'car' && (
              <View style={[st.banner, { backgroundColor: '#FEF3C7', borderColor: '#F59E0B' }]}>
                <Animated.Text style={{ fontSize: 28, marginBottom: 8, transform: [{ rotate: rotation }] }}>🚗</Animated.Text>
                <Text style={{ fontSize: 16, fontWeight: '700', color: '#92400E' }}>Waiting for Car Requests</Text>
                <Text style={{ fontSize: 12, color: '#92400E', marginTop: 4 }}>You're online! Ready to accept rides</Text>
              </View>
            )}

            {/* KYC Form */}
            <View style={st.section}>
              <Text style={st.sectionTitle}>👤 Personal Information</Text>
              <Input label="Full Name *" value={fullName} onChangeText={setFullName} editable={!isApproved || isEditingKyc} />
              <Input label="Aadhar Number *" value={aadharNum} onChangeText={setAadharNum} keyboardType="numeric" maxLength={12} editable={!isApproved || isEditingKyc} />
              <Input label="Driving License *" value={licenseNum} onChangeText={setLicenseNum} editable={!isApproved || isEditingKyc} />
            </View>

            <View style={st.section}>
              <Text style={st.sectionTitle}>🚗 Vehicle Details</Text>
              <Text style={st.label}>Vehicle Type *</Text>
              <View style={st.vehicleGrid}>
                {(() => {
                  // Get all unique vehicles from both parcel and ride (for driver to choose)
                  const allVehicles = [
                    ...settings.parcelVehicles,
                    ...settings.rideVehicles.filter(rv => !settings.parcelVehicles.find(pv => pv.id === rv.id))
                  ];
                  return allVehicles.map((v) => (
                    <TouchableOpacity
                      key={v.id}
                      style={[st.vehicleBtn, vehicleType === v.id && st.vehicleBtnActive]}
                      onPress={() => setVehicleType(v.id)}
                      disabled={isApproved && !isEditingKyc}
                    >
                      <Text style={st.vehicleLabel}>{v.label}</Text>
                    </TouchableOpacity>
                  ));
                })()}
              </View>
              <Input label="Vehicle Model *" value={vehicleModel} onChangeText={setVehicleModel} editable={!isApproved || isEditingKyc} />
              <Input label="Vehicle Number *" value={vehicleNumber} onChangeText={setVehicleNumber} editable={!isApproved || isEditingKyc} />
            </View>

            <View style={st.section}>
              <Text style={st.sectionTitle}>📸 Upload Documents</Text>
              <DocBtn label="Aadhar Card" photo={aadharPhoto} onPress={() => handleUploadDoc(setAadharPhoto)} disabled={isApproved && !isEditingKyc} />
              <DocBtn label="Driving License" photo={licensePhoto} onPress={() => handleUploadDoc(setLicensePhoto)} disabled={isApproved && !isEditingKyc} />
              <DocBtn label="Vehicle RC" photo={rcPhoto} onPress={() => handleUploadDoc(setRcPhoto)} disabled={isApproved && !isEditingKyc} />
            </View>

            {kycStatus !== 'approved' && (
              <TouchableOpacity style={[st.submitBtn, uploading && { opacity: 0.5 }]} onPress={handleKycSubmit} disabled={uploading}>
                <Text style={st.btnText}>{uploading ? uploadProgress : '✅ Submit KYC'}</Text>
              </TouchableOpacity>
            )}

            {isApproved && !isEditingKyc && (
              <TouchableOpacity style={[st.submitBtn, { backgroundColor: '#F59E0B' }]} onPress={() => setIsEditingKyc(true)}>
                <Text style={st.btnText}>✏️ Edit KYC</Text>
              </TouchableOpacity>
            )}

            {isApproved && isEditingKyc && (
              <View style={st.buttonGroup}>
                <TouchableOpacity style={[st.submitBtn, uploading && { opacity: 0.5 }]} onPress={handleKycSubmit} disabled={uploading}>
                  <Text style={st.btnText}>{uploading ? uploadProgress : '✅ Save Changes'}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[st.submitBtn, { backgroundColor: '#6B7280' }]} onPress={() => setIsEditingKyc(false)}>
                  <Text style={st.btnText}>✕ Cancel</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Input({ label, value, onChangeText, keyboardType = 'default', maxLength, editable = true }) {
  return (
    <View style={st.inputGroup}>
      <Text style={st.label}>{label}</Text>
      <TextInput style={[st.input, !editable && { backgroundColor: '#F3F4F6' }]} value={value} onChangeText={onChangeText} keyboardType={keyboardType} maxLength={maxLength} editable={editable} />
    </View>
  );
}

function DocBtn({ label, photo, onPress, disabled }) {
  const isUploaded = photo && photo.startsWith('https');
  const isSelected = photo && !photo.startsWith('https');

  return (
    <TouchableOpacity style={[st.docBtn, disabled && { opacity: 0.5 }]} onPress={onPress} disabled={disabled}>
      {isUploaded ? (
        <>
          <Image source={{ uri: photo }} style={st.docThumb} />
          <Text style={{ color: '#10B981', fontWeight: '700' }}>✅ {label}</Text>
        </>
      ) : isSelected ? (
        <>
          <Text style={{ fontSize: 28 }}>⏳</Text>
          <Text style={{ color: '#F59E0B', fontWeight: '700' }}>📸 {label} Selected</Text>
        </>
      ) : (
        <>
          <Text style={{ fontSize: 28 }}>📸</Text>
          <Text style={{ color: '#6B7280' }}>Tap to upload {label}</Text>
        </>
      )}
    </TouchableOpacity>
  );
}

function InfoRow({ label, value }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' }}>
      <Text style={{ fontSize: 13, color: '#6B7280', fontWeight: '600' }}>{label}</Text>
      <Text style={{ fontSize: 14, color: '#1F2937', fontWeight: '600' }}>{value || '—'}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  scroll: { padding: 20, paddingBottom: 40 },
  title: { fontSize: 24, fontWeight: '700', color: '#1F2937', marginBottom: 20 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: '#E5E7EB' },
  cardTitle: { fontSize: 16, fontWeight: '700', color: '#1F2937', marginBottom: 12 },
  banner: { borderWidth: 2, borderRadius: 12, padding: 16, marginBottom: 20, alignItems: 'center' },
  section: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: '#E5E7EB' },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#1F2937', marginBottom: 12 },
  label: { fontSize: 12, fontWeight: '700', color: '#6B7280', marginBottom: 8, letterSpacing: 0.5 },
  inputGroup: { marginBottom: 14 },
  input: { backgroundColor: '#F9FAFB', borderWidth: 1.5, borderColor: '#E5E7EB', borderRadius: 10, padding: 12, fontSize: 14 },
  vehicleGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  vehicleBtn: { flex: 1, minWidth: '45%', paddingVertical: 10, paddingHorizontal: 12, borderRadius: 8, borderWidth: 2, borderColor: '#E5E7EB', backgroundColor: '#fff', alignItems: 'center' },
  vehicleBtnActive: { borderColor: '#10B981', backgroundColor: '#10B98115' },
  vehicleLabel: { fontSize: 13, fontWeight: '600', color: '#1F2937' },
  docBtn: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 12, borderWidth: 2, borderColor: '#E5E7EB', borderRadius: 10, marginBottom: 10, backgroundColor: '#fff' },
  docThumb: { width: 60, height: 60, borderRadius: 8 },
  buttonGroup: { gap: 10, marginTop: 20 },
  btn: { backgroundColor: '#10B981', paddingVertical: 16, borderRadius: 12, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  submitBtn: { backgroundColor: '#10B981', paddingVertical: 16, borderRadius: 12, alignItems: 'center', marginTop: 20 },
});