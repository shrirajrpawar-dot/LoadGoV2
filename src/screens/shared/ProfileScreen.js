import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView, Alert, ActivityIndicator, Image, Animated } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
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

  // Auto-show KYC tab for new drivers who haven't started KYC yet
  useEffect(() => {
    const kycStatus = driverDoc?.kyc?.status || 'not_started';
    if (profile?.isDriver && (kycStatus === 'not_started' || kycStatus === 'rejected')) {
      setActiveTab('kyc');
    }
  }, [profile?.isDriver, driverDoc?.kyc?.status]);
  // Derive isDriver from props synchronously so it never lags behind a re-render.
  // This is what was causing the "View KYC" button to not redirect — the
  // useState version flipped between renders.
  const isDriver = !!driverDoc || profile?.mode === 'driver';
  const [isEditingKyc, setIsEditingKyc] = useState(false);
  
  // KYC states
  const [fullName, setFullName] = useState('');
  const [aadharNum, setAadharNum] = useState('');
  const [licenseNum, setLicenseNum] = useState('');
  const [panNum, setPanNum] = useState('');
  const [bankIfsc, setBankIfsc] = useState('');
  const [bankAccountNumber, setBankAccountNumber] = useState('');
  const [bankAccountHolderName, setBankAccountHolderName] = useState('');
  const [upiId, setUpiId] = useState('');
  const [vehicleType, setVehicleType] = useState('bike');
  const [vehicleModel, setVehicleModel] = useState('');
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [aadharPhoto, setAadharPhoto] = useState(null);
  const [licensePhoto, setLicensePhoto] = useState(null);
  const [rcPhoto, setRcPhoto] = useState(null);
  const [panPhoto, setPanPhoto] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');

  // Animation states
  const [pulseAnim] = useState(new Animated.Value(1));
  const [rotateAnim] = useState(new Animated.Value(0));

  useEffect(() => {
    if (!user?.uid) return;
    
    const unsub = onSnapshot(doc(db, 'drivers', user.uid), (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        setFullName(data.kyc?.fullName || '');
        setAadharNum(data.kyc?.aadharNumber || '');
        setLicenseNum(data.kyc?.licenseNumber || '');
        setPanNum(data.kyc?.panNumber || '');
        setBankIfsc(data.kyc?.bank?.ifsc || '');
        setBankAccountNumber(data.kyc?.bank?.accountNumber || '');
        setBankAccountHolderName(data.kyc?.bank?.accountHolderName || '');
        setUpiId(data.kyc?.upiId || '');
        setVehicleType(data.vehicle?.type || 'bike');
        setVehicleModel(data.vehicle?.model || '');
        setVehicleNumber(data.vehicle?.number || '');
        if (data.kyc?.aadharPhoto) setAadharPhoto(data.kyc.aadharPhoto);
        if (data.kyc?.licensePhoto) setLicensePhoto(data.kyc.licensePhoto);
        if (data.kyc?.rcPhoto) setRcPhoto(data.kyc.rcPhoto);
        if (data.kyc?.panPhoto) setPanPhoto(data.kyc.panPhoto);
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
    if (!panNum.trim() || !/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/i.test(panNum.trim())) {
      Alert.alert('Required', 'Enter valid PAN (format: ABCDE1234F)'); return;
    }
    if (!bankAccountHolderName.trim()) { Alert.alert('Required', 'Enter bank account holder name'); return; }
    if (!bankIfsc.trim() || !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(bankIfsc.trim().toUpperCase())) {
      Alert.alert('Required', 'Enter valid IFSC (e.g. HDFC0001234)'); return;
    }
    if (!bankAccountNumber.trim() || !/^[0-9]{9,18}$/.test(bankAccountNumber.trim())) {
      Alert.alert('Required', 'Enter valid account number (9–18 digits)'); return;
    }
    // UPI ID is optional; if entered, validate format
    if (upiId.trim() && !/^[a-z0-9._-]+@[a-z]+$/i.test(upiId.trim())) {
      Alert.alert('Invalid UPI', 'UPI ID must be in format: name@bank (e.g. 9876543210@paytm)'); return;
    }
    if (!vehicleModel.trim()) { Alert.alert('Required', 'Enter vehicle model'); return; }
    if (!vehicleNumber.trim()) { Alert.alert('Required', 'Enter vehicle number'); return; }
    if (!aadharPhoto) { Alert.alert('Required', 'Upload Aadhar photo'); return; }
    if (!licensePhoto) { Alert.alert('Required', 'Upload license photo'); return; }
    if (!panPhoto) { Alert.alert('Required', 'Upload PAN photo'); return; }
    if (!rcPhoto) { Alert.alert('Required', 'Upload RC photo'); return; }

    setUploading(true);
    try {
      let aadharUrl = aadharPhoto;
      let licenseUrl = licensePhoto;
      let rcUrl = rcPhoto;
      let panUrl = panPhoto;

      if (!aadharPhoto.startsWith('https')) {
        aadharUrl = await uploadImageToStorage(aadharPhoto, 'aadhar');
        if (!aadharUrl) throw new Error('Failed to upload Aadhar photo');
      }

      if (!licensePhoto.startsWith('https')) {
        licenseUrl = await uploadImageToStorage(licensePhoto, 'license');
        if (!licenseUrl) throw new Error('Failed to upload License photo');
      }

      if (!panPhoto.startsWith('https')) {
        panUrl = await uploadImageToStorage(panPhoto, 'pan');
        if (!panUrl) throw new Error('Failed to upload PAN photo');
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
        'kyc.panNumber': panNum.toUpperCase(),
        'kyc.bank': {
          ifsc: bankIfsc.trim().toUpperCase(),
          accountNumber: bankAccountNumber.trim(),
          accountHolderName: bankAccountHolderName.trim(),
        },
        'kyc.upiId': upiId.trim().toLowerCase(),
        'kyc.aadharPhoto': aadharUrl,
        'kyc.licensePhoto': licenseUrl,
        'kyc.panPhoto': panUrl,
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
      '🚗 Become a Driver',
      'You\'ll need to complete KYC verification to start accepting bookings.\n\nReady to proceed?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Yes, Continue',
          onPress: async () => {
            try {
              await joinAsDriver();
              // KYC tab will auto-show via useEffect
              Alert.alert('✅ Welcome!', 'Please fill in your KYC details to get started.');
            } catch (e) {
              Alert.alert('Error', e.message);
            }
          },
        }
      ]
    );
  };

  const kycStatus = driverDoc?.kyc?.status || 'not_started';
  const isApproved = kycStatus === 'approved' || kycStatus === 'verified';
  const isPending = kycStatus === 'pending' || kycStatus === 'submitted' || kycStatus === 'under_review';
  const isRejected = kycStatus === 'rejected';
  const isNotStarted = !isApproved && !isPending && !isRejected;

  return (
    <SafeAreaView style={st.container}>
      <ScrollView contentContainerStyle={st.scroll}>
        {/* PROFILE TAB */}
        {activeTab === 'profile' && (
          <View>
            <View style={st.headerBlock}>
              <Text style={st.title}>Profile</Text>
              <Text style={st.subtitle}>Manage your account</Text>
            </View>

            {/* Avatar header */}
            <View style={st.avatarBlock}>
              <View style={st.avatarCircle}>
                <Ionicons name="person" size={36} color="#10B981" />
              </View>
              <Text style={st.avatarName}>{profile?.name || 'User'}</Text>
              <View style={[st.modePill, profile?.mode === 'driver' ? st.modePillDriver : st.modePillCustomer]}>
                <Ionicons name={profile?.mode === 'driver' ? 'car' : 'person-circle-outline'} size={14} color={profile?.mode === 'driver' ? '#92400E' : '#1E40AF'} />
                <Text style={[st.modePillText, { color: profile?.mode === 'driver' ? '#92400E' : '#1E40AF' }]}>
                  {profile?.mode === 'driver' ? 'Driver' : 'Customer'}
                </Text>
              </View>
            </View>

            <Text style={st.sectionLabel}>Account</Text>
            <View style={st.card}>
              <InfoRow icon="person-outline" label="Name" value={profile?.name} />
              <InfoRow icon="call-outline" label="Phone" value={profile?.phone} />
              <InfoRow icon="mail-outline" label="Email" value={profile?.email} />
            </View>

            {/* Driver Info */}
            {isDriver && driverDoc && (
              <>
                <Text style={st.sectionLabel}>Driver Status</Text>
                <View style={st.card}>
                  <InfoRow
                    icon="shield-checkmark-outline"
                    label="KYC"
                    value={isApproved ? 'Approved' : isPending ? 'Under Review' : isRejected ? 'Rejected' : 'Pending submission'}
                    valueColor={isApproved ? '#10B981' : isPending ? '#F59E0B' : isRejected ? '#EF4444' : '#3B82F6'}
                  />
                  {driverDoc.vehicle?.label && <InfoRow icon="car-outline" label="Vehicle" value={driverDoc.vehicle.label} />}
                  <InfoRow icon="today-outline" label="Today's Earnings" value={`₹${Math.round((driverDoc.earnings?.todayInPaise || 0) / 100)}`} valueColor="#10B981" />
                  <InfoRow icon="wallet-outline" label="Total Earnings" value={`₹${Math.round((driverDoc.earnings?.totalInPaise || 0) / 100)}`} valueColor="#10B981" />
                </View>
              </>
            )}

            {/* Action Buttons - CUSTOMER ONLY */}
            {!isDriver && (
              <View style={st.buttonGroup}>
                <TouchableOpacity style={st.primaryBtn} onPress={handleJoinAsDriver}>
                  <Ionicons name="car-sport" size={18} color="#FFFFFF" />
                  <Text style={st.primaryBtnText}>Join as Driver</Text>
                </TouchableOpacity>
                <TouchableOpacity style={st.dangerBtn} onPress={handleSignOut}>
                  <Ionicons name="log-out-outline" size={18} color="#EF4444" />
                  <Text style={st.dangerBtnText}>Sign Out</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Action Buttons - DRIVER ONLY */}
            {isDriver && (
              <View style={st.buttonGroup}>
                <TouchableOpacity style={st.primaryBtn} onPress={() => setActiveTab('kyc')}>
                  <Ionicons name="document-text-outline" size={18} color="#FFFFFF" />
                  <Text style={st.primaryBtnText}>{isApproved ? 'View KYC' : 'Update KYC'}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={st.dangerBtn} onPress={handleSignOut}>
                  <Ionicons name="log-out-outline" size={18} color="#EF4444" />
                  <Text style={st.dangerBtnText}>Sign Out</Text>
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
              style={st.backRow}
            >
              <Ionicons name="arrow-back" size={20} color="#111827" />
              <Text style={st.backText}>Back to Profile</Text>
            </TouchableOpacity>

            <View style={st.headerBlock}>
              <Text style={st.title}>KYC Verification</Text>
              <Text style={st.subtitle}>Complete your driver profile</Text>
            </View>

            {/* KYC Status Banners */}
            {isApproved && (
              <View style={[st.banner, { backgroundColor: '#ECFDF5', borderColor: '#A7F3D0' }]}>
                <View style={[st.bannerIcon, { backgroundColor: '#A7F3D0' }]}>
                  <Ionicons name="checkmark-circle" size={20} color="#065F46" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[st.bannerTitle, { color: '#065F46' }]}>KYC Approved</Text>
                  <Text style={[st.bannerSub, { color: '#047857' }]}>You can go online and accept bookings</Text>
                </View>
              </View>
            )}

            {isPending && (
              <Animated.View style={[st.banner, { backgroundColor: '#FEF3C7', borderColor: '#FDE68A', transform: [{ scale: pulseAnim }] }]}>
                <Animated.View style={[st.bannerIcon, { backgroundColor: '#FDE68A', transform: [{ rotate: rotation }] }]}>
                  <Ionicons name="hourglass-outline" size={20} color="#92400E" />
                </Animated.View>
                <View style={{ flex: 1 }}>
                  <Text style={[st.bannerTitle, { color: '#92400E' }]}>Under Review</Text>
                  <Text style={[st.bannerSub, { color: '#92400E' }]}>Our team is verifying your KYC</Text>
                </View>
              </Animated.View>
            )}

            {isRejected && (
              <View style={[st.banner, { backgroundColor: '#FEF2F2', borderColor: '#FECACA' }]}>
                <View style={[st.bannerIcon, { backgroundColor: '#FECACA' }]}>
                  <Ionicons name="close-circle" size={20} color="#991B1B" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[st.bannerTitle, { color: '#991B1B' }]}>KYC Rejected</Text>
                  <Text style={[st.bannerSub, { color: '#B91C1C' }]}>
                    {driverDoc?.kyc?.rejectionReason || 'Please review and resubmit'}
                  </Text>
                </View>
              </View>
            )}

            {isNotStarted && (
              <View style={[st.banner, { backgroundColor: '#EFF6FF', borderColor: '#BFDBFE' }]}>
                <View style={[st.bannerIcon, { backgroundColor: '#BFDBFE' }]}>
                  <Ionicons name="information-circle-outline" size={20} color="#1E40AF" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[st.bannerTitle, { color: '#1E40AF' }]}>Get Started</Text>
                  <Text style={[st.bannerSub, { color: '#1E40AF' }]}>Fill the form below to submit your KYC</Text>
                </View>
              </View>
            )}

            {/* KYC Form */}
            <Text style={st.sectionLabel}>Personal Information</Text>
            <View style={st.section}>
              <Input label="Full Name" value={fullName} onChangeText={setFullName} editable={!isApproved || isEditingKyc} />
              <Input label="Aadhar Number" value={aadharNum} onChangeText={setAadharNum} keyboardType="numeric" maxLength={12} editable={!isApproved || isEditingKyc} />
              <Input label="PAN Number" value={panNum} onChangeText={(t) => setPanNum(t.toUpperCase())} maxLength={10} editable={!isApproved || isEditingKyc} placeholder="ABCDE1234F" />
              <Input label="Driving License" value={licenseNum} onChangeText={setLicenseNum} editable={!isApproved || isEditingKyc} />
            </View>

            <Text style={st.sectionLabel}>Vehicle Details</Text>
            <View style={st.section}>
              <Text style={st.label}>Vehicle Type</Text>
              <View style={st.vehicleGrid}>
                {(() => {
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
                      <Text style={[st.vehicleLabel, vehicleType === v.id && st.vehicleLabelActive]}>{v.label}</Text>
                    </TouchableOpacity>
                  ));
                })()}
              </View>
              <Input label="Vehicle Model" value={vehicleModel} onChangeText={setVehicleModel} editable={!isApproved || isEditingKyc} />
              <Input label="Vehicle Number" value={vehicleNumber} onChangeText={setVehicleNumber} editable={!isApproved || isEditingKyc} />
            </View>

            <Text style={st.sectionLabel}>Documents</Text>
            <View style={st.section}>
              <DocBtn label="Aadhar Card" photo={aadharPhoto} onPress={() => handleUploadDoc(setAadharPhoto)} disabled={isApproved && !isEditingKyc} />
              <DocBtn label="PAN Card" photo={panPhoto} onPress={() => handleUploadDoc(setPanPhoto)} disabled={isApproved && !isEditingKyc} />
              <DocBtn label="Driving License" photo={licensePhoto} onPress={() => handleUploadDoc(setLicensePhoto)} disabled={isApproved && !isEditingKyc} />
              <DocBtn label="Vehicle RC" photo={rcPhoto} onPress={() => handleUploadDoc(setRcPhoto)} disabled={isApproved && !isEditingKyc} />
            </View>

            <Text style={st.sectionLabel}>Bank Details</Text>
            <View style={st.section}>
              <Input label="Account Holder Name" value={bankAccountHolderName} onChangeText={setBankAccountHolderName} editable={!isApproved || isEditingKyc} placeholder="As per bank records" />
              <Input label="Account Number" value={bankAccountNumber} onChangeText={(t) => setBankAccountNumber(t.replace(/[^0-9]/g, ''))} keyboardType="numeric" maxLength={18} editable={!isApproved || isEditingKyc} placeholder="9 to 18 digits" />
              <Input label="IFSC Code" value={bankIfsc} onChangeText={(t) => setBankIfsc(t.toUpperCase())} maxLength={11} editable={!isApproved || isEditingKyc} placeholder="HDFC0001234" />
            </View>

            <Text style={st.sectionLabel}>UPI ID (for receiving customer payments)</Text>
            <View style={st.section}>
              <Input
                label="Your UPI ID"
                value={upiId}
                onChangeText={(t) => setUpiId(t.toLowerCase().replace(/[^a-z0-9._@-]/g, ''))}
                editable={!isApproved || isEditingKyc}
                placeholder="9876543210@paytm or yourname@upi"
                autoCapitalize="none"
              />
              <Text style={{ fontSize: 11, color: '#6B7280', fontWeight: '500', marginTop: -8, marginBottom: 8 }}>
                Customers paying via UPI will send money to this ID. Optional, but required to accept UPI bookings.
              </Text>
            </View>

            {kycStatus !== 'approved' && (
              <TouchableOpacity style={[st.primaryBtn, { marginTop: 8 }, uploading && { opacity: 0.5 }]} onPress={handleKycSubmit} disabled={uploading}>
                {uploading ? <ActivityIndicator color="#FFF" /> : (
                  <>
                    <Ionicons name="checkmark-circle" size={18} color="#FFFFFF" />
                    <Text style={st.primaryBtnText}>Submit KYC</Text>
                  </>
                )}
              </TouchableOpacity>
            )}

            {isApproved && !isEditingKyc && (
              <TouchableOpacity style={[st.amberBtn, { marginTop: 8 }]} onPress={() => setIsEditingKyc(true)}>
                <Ionicons name="create-outline" size={18} color="#92400E" />
                <Text style={st.amberBtnText}>Edit KYC</Text>
              </TouchableOpacity>
            )}

            {isApproved && isEditingKyc && (
              <View style={st.buttonGroup}>
                <TouchableOpacity style={[st.primaryBtn, uploading && { opacity: 0.5 }]} onPress={handleKycSubmit} disabled={uploading}>
                  {uploading ? <ActivityIndicator color="#FFF" /> : (
                    <>
                      <Ionicons name="save-outline" size={18} color="#FFFFFF" />
                      <Text style={st.primaryBtnText}>Save Changes</Text>
                    </>
                  )}
                </TouchableOpacity>
                <TouchableOpacity style={st.dangerBtn} onPress={() => setIsEditingKyc(false)}>
                  <Ionicons name="close" size={18} color="#EF4444" />
                  <Text style={st.dangerBtnText}>Cancel</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Input({ label, value, onChangeText, keyboardType = 'default', maxLength, editable = true, placeholder }) {
  return (
    <View style={st.inputGroup}>
      <Text style={st.label}>{label}</Text>
      <TextInput
        style={[st.input, !editable && st.inputDisabled]}
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType}
        maxLength={maxLength}
        editable={editable}
        placeholder={placeholder}
        placeholderTextColor="#9CA3AF"
      />
    </View>
  );
}

function DocBtn({ label, photo, onPress, disabled }) {
  const isUploaded = photo && photo.startsWith('https');
  const isSelected = photo && !photo.startsWith('https');

  return (
    <TouchableOpacity style={[st.docBtn, disabled && { opacity: 0.6 }]} onPress={onPress} disabled={disabled}>
      {isUploaded ? (
        <>
          <Image source={{ uri: photo }} style={st.docThumb} />
          <View style={{ flex: 1 }}>
            <Text style={st.docLabel}>{label}</Text>
            <View style={st.docStatusRow}>
              <Ionicons name="checkmark-circle" size={14} color="#10B981" />
              <Text style={st.docStatusOk}>Uploaded</Text>
            </View>
          </View>
        </>
      ) : isSelected ? (
        <>
          <View style={st.docIconBox}>
            <Ionicons name="hourglass-outline" size={22} color="#F59E0B" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={st.docLabel}>{label}</Text>
            <Text style={st.docStatusPending}>Selected — submit to upload</Text>
          </View>
        </>
      ) : (
        <>
          <View style={st.docIconBox}>
            <Ionicons name="camera-outline" size={22} color="#6B7280" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={st.docLabel}>{label}</Text>
            <Text style={st.docStatusEmpty}>Tap to upload</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color="#9CA3AF" />
        </>
      )}
    </TouchableOpacity>
  );
}

function InfoRow({ icon, label, value, valueColor }) {
  return (
    <View style={st.infoRow}>
      {icon ? (
        <View style={st.infoIconBox}>
          <Ionicons name={icon} size={16} color="#6B7280" />
        </View>
      ) : null}
      <Text style={st.infoLabel}>{label}</Text>
      <Text style={[st.infoValue, valueColor && { color: valueColor }]}>{value || '—'}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F3F4F6' },
  scroll: { padding: 16, paddingBottom: 40 },

  headerBlock: { paddingHorizontal: 4, paddingTop: 8, paddingBottom: 16 },
  title: { fontSize: 26, fontWeight: '800', color: '#111827' },
  subtitle: { fontSize: 13, color: '#6B7280', fontWeight: '600', marginTop: 2 },

  backRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, marginBottom: 4 },
  backText: { fontSize: 15, fontWeight: '700', color: '#111827' },

  // Avatar header
  avatarBlock: { alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 20, padding: 24, marginBottom: 16, borderWidth: 1, borderColor: '#F3F4F6' },
  avatarCircle: { width: 80, height: 80, borderRadius: 40, backgroundColor: '#ECFDF5', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#A7F3D0' },
  avatarName: { fontSize: 20, fontWeight: '800', color: '#111827', marginTop: 12 },
  modePill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, marginTop: 10 },
  modePillCustomer: { backgroundColor: '#DBEAFE' },
  modePillDriver: { backgroundColor: '#FDE68A' },
  modePillText: { fontSize: 12, fontWeight: '800' },

  // Section labels
  sectionLabel: { fontSize: 12, fontWeight: '800', color: '#6B7280', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 8, marginTop: 8, paddingHorizontal: 4 },

  // Cards
  card: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 4, marginBottom: 16, borderWidth: 1, borderColor: '#F3F4F6' },
  cardTitle: { fontSize: 16, fontWeight: '800', color: '#111827', marginBottom: 12 },

  // Section blocks (KYC form)
  section: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: '#F3F4F6' },

  // Banner (KYC status)
  banner: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 16, padding: 16, marginBottom: 16 },
  bannerIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  bannerTitle: { fontSize: 14, fontWeight: '800' },
  bannerSub: { fontSize: 12, fontWeight: '600', marginTop: 2 },

  // InfoRow
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  infoIconBox: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center' },
  infoLabel: { fontSize: 13, color: '#6B7280', flex: 1, fontWeight: '600' },
  infoValue: { fontSize: 14, color: '#111827', fontWeight: '700' },

  // Inputs
  label: { fontSize: 13, fontWeight: '700', color: '#374151', marginBottom: 8 },
  inputGroup: { marginBottom: 14 },
  input: { backgroundColor: '#F9FAFB', borderWidth: 1, borderColor: '#F3F4F6', borderRadius: 14, padding: 14, fontSize: 14, color: '#111827', fontWeight: '500' },
  inputDisabled: { backgroundColor: '#F3F4F6', color: '#6B7280' },

  // Vehicle grid
  vehicleGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  vehicleBtn: { flex: 1, minWidth: '45%', paddingVertical: 12, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: '#F3F4F6', backgroundColor: '#F9FAFB', alignItems: 'center' },
  vehicleBtnActive: { borderColor: '#10B981', backgroundColor: '#ECFDF5' },
  vehicleLabel: { fontSize: 13, fontWeight: '600', color: '#374151' },
  vehicleLabelActive: { color: '#065F46', fontWeight: '700' },

  // Doc upload button
  docBtn: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 12, borderWidth: 1, borderColor: '#F3F4F6', borderRadius: 12, marginBottom: 8, backgroundColor: '#F9FAFB' },
  docIconBox: { width: 44, height: 44, borderRadius: 12, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#F3F4F6' },
  docThumb: { width: 44, height: 44, borderRadius: 10 },
  docLabel: { fontSize: 14, fontWeight: '700', color: '#111827' },
  docStatusRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  docStatusOk: { fontSize: 12, color: '#10B981', fontWeight: '700' },
  docStatusPending: { fontSize: 12, color: '#F59E0B', fontWeight: '600', marginTop: 2 },
  docStatusEmpty: { fontSize: 12, color: '#6B7280', fontWeight: '500', marginTop: 2 },

  // Buttons
  buttonGroup: { gap: 10, marginTop: 8 },
  primaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#111827', paddingVertical: 16, borderRadius: 14 },
  primaryBtnText: { color: '#FFFFFF', fontWeight: '800', fontSize: 15 },
  amberBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#FEF3C7', paddingVertical: 16, borderRadius: 14, borderWidth: 1, borderColor: '#FDE68A' },
  amberBtnText: { color: '#92400E', fontWeight: '800', fontSize: 15 },
  dangerBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#FEF2F2', paddingVertical: 16, borderRadius: 14, borderWidth: 1, borderColor: '#FECACA' },
  dangerBtnText: { color: '#EF4444', fontWeight: '800', fontSize: 15 },
});