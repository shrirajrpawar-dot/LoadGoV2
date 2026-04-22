import React, { useEffect, useState, useRef } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Alert, ActivityIndicator, Switch, ScrollView, TextInput, Linking, Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  collection, query, where, onSnapshot,
  doc, updateDoc, getDoc, serverTimestamp, arrayUnion,
} from 'firebase/firestore';
import { db } from '../../../firebase';
import { useAuth } from '../../contexts/AuthContext';

const VLABELS = {
  bike: '🏍️ Bike', '3wheeler': '🛺 3 Wheeler',
  chota_hatti: '🚛 Chota Hatti', tempo: '🚚 Tempo',
};

// Pulsing green dot when online
function OnlinePulse() {
  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(0.8)).current;
  useEffect(() => {
    const pulse = Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(scale, { toValue: 2, duration: 900, useNativeDriver: true }),
          Animated.timing(scale, { toValue: 1, duration: 900, useNativeDriver: true }),
        ]),
        Animated.sequence([
          Animated.timing(opacity, { toValue: 0, duration: 900, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 0.8, duration: 900, useNativeDriver: true }),
        ]),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, []);
  return (
    <View style={{ width: 20, height: 20, justifyContent: 'center', alignItems: 'center', marginRight: 6 }}>
      <Animated.View style={{ position: 'absolute', width: 16, height: 16, borderRadius: 8, backgroundColor: '#10B981', opacity, transform: [{ scale }] }} />
      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: '#10B981' }} />
    </View>
  );
}

export default function DriverHome() {
  const { user, driverDoc } = useAuth();
  const [isOnline, setIsOnline] = useState(false);
  const [allSearching, setAllSearching] = useState([]);
  const [myBookings, setMyBookings] = useState([]);
  const [otpInput, setOtpInput] = useState('');
  const [otpError, setOtpError] = useState('');
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const prevStatusRef = useRef(null);

  const kycStatus = driverDoc?.kyc?.status || 'not_started';
  const isKycApproved = kycStatus === 'approved';
  // FIX: get vehicle type from driverDoc (real-time)
  const myVehicle = driverDoc?.vehicle?.type;

  // Current active booking (one I'm working on)
  const currentBooking = myBookings.find((b) =>
    ['accepted', 'at_pickup', 'in_progress', 'at_drop'].includes(b.status)
  ) || null;

  // FIX: Filter by vehicle type AND exclude bookings this driver already rejected
  const availableBookings = allSearching.filter((b) => {
    // Must match vehicle type
    if (myVehicle && b.vehicleType !== myVehicle) return false;
    // Must not be already rejected by this driver
    if (b.rejectedByDrivers && b.rejectedByDrivers.includes(user?.uid)) return false;
    return true;
  });

  // Reset OTP input when booking status changes
  useEffect(() => {
    if (currentBooking?.status !== prevStatusRef.current) {
      setOtpInput('');
      setOtpError('');
      prevStatusRef.current = currentBooking?.status || null;
    }
  }, [currentBooking?.status]);

  // Firestore listeners — only depends on user.uid, NOT on driverDoc/vehicle
  useEffect(() => {
    if (!user?.uid) { setLoading(false); return; }

    // 1. Driver online status
    const unsubDriver = onSnapshot(doc(db, 'drivers', user.uid), (snap) => {
      if (snap.exists()) setIsOnline(snap.data().status === 'online');
    });

    // 2. ALL searching bookings — filter client-side so we don't miss existing ones
    const unsubSearching = onSnapshot(
      query(collection(db, 'bookings'), where('status', '==', 'searching')),
      (snap) => {
        setAllSearching(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setLoading(false);
      },
      (err) => { console.error('Searching error:', err); setLoading(false); }
    );

    // 3. Bookings assigned to ME
    const unsubMine = onSnapshot(
      query(collection(db, 'bookings'), where('driverId', '==', user.uid)),
      (snap) => {
        setMyBookings(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      },
      (err) => { console.error('My bookings error:', err); }
    );

    return () => { unsubDriver(); unsubSearching(); unsubMine(); };
  }, [user?.uid]);

  // ---- ACTIONS ----

  const toggleOnline = async () => {
    if (!isKycApproved) {
      Alert.alert('🔒 KYC Required', 'Get KYC approved first. Go to the KYC tab.');
      return;
    }
    if (!myVehicle) {
      Alert.alert('Error', 'No vehicle set in KYC. Resubmit KYC.');
      return;
    }
    try {
      await updateDoc(doc(db, 'drivers', user.uid), {
        status: isOnline ? 'offline' : 'online',
      });
    } catch (e) { Alert.alert('Error', e.message); }
  };

  const acceptBooking = async (bookingId) => {
    setActionLoading(true);
    try {
      await updateDoc(doc(db, 'bookings', bookingId), {
        status: 'accepted',
        driverId: user.uid,
        driverName: driverDoc?.kyc?.fullName || driverDoc?.name || 'Driver',
        driverPhone: driverDoc?.phone || '',
        driverVehicle: myVehicle,
        acceptedAt: serverTimestamp(),
      });
      Alert.alert('✅ Booking Accepted!', 'Head to the pickup location.');
    } catch (e) { Alert.alert('Error', e.message); }
    setActionLoading(false);
  };

  // FIX: Use arrayUnion so the booking is properly removed from driver's list
  const rejectBooking = (bookingId) => {
    Alert.alert('Reject Booking?', 'This booking will be removed from your list.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reject',
        style: 'destructive',
        onPress: async () => {
          setActionLoading(true);
          try {
            await updateDoc(doc(db, 'bookings', bookingId), {
              rejectedByDrivers: arrayUnion(user.uid), // ← FIX: arrayUnion not [] + []
            });
            // No alert needed — booking just disappears from list
          } catch (e) { Alert.alert('Error', e.message); }
          setActionLoading(false);
        },
      },
    ]);
  };

  const updateBookingStatus = async (newStatus) => {
    if (!currentBooking) return;
    setActionLoading(true);
    try {
      const updates = { status: newStatus };
      if (newStatus === 'at_pickup') updates.arrivedAtPickupAt = serverTimestamp();
      if (newStatus === 'at_drop') updates.arrivedAtDropAt = serverTimestamp();
      await updateDoc(doc(db, 'bookings', currentBooking.id), updates);
    } catch (e) { Alert.alert('Error', e.message); }
    setActionLoading(false);
  };

  const verifyOtp = async (type) => {
    setOtpError('');
    if (otpInput.length !== 4) { setOtpError('Enter 4-digit OTP'); return; }

    const correctOtp = type === 'pickup' ? currentBooking.pickupOtp : currentBooking.deliveryOtp;
    if (otpInput !== correctOtp) {
      setOtpError('Wrong OTP! Ask customer again.');
      setOtpInput('');
      return;
    }

    setActionLoading(true);
    try {
      if (type === 'pickup') {
        await updateDoc(doc(db, 'bookings', currentBooking.id), {
          status: 'in_progress',
          pickupVerifiedAt: serverTimestamp(),
        });
        setOtpInput('');
        Alert.alert('✅ Pickup Verified!', 'Drive to the drop location.');
      } else {
        await updateDoc(doc(db, 'bookings', currentBooking.id), {
          status: 'completed',
          deliveryVerifiedAt: serverTimestamp(),
          completedAt: serverTimestamp(),
        });
        const earning = Math.round((currentBooking.fare?.totalInPaise || 0) * 0.8);
        const driverRef = doc(db, 'drivers', user.uid);
        const driverSnap = await getDoc(driverRef);
        const cur = driverSnap.data()?.earnings || { todayInPaise: 0, totalInPaise: 0 };
        await updateDoc(driverRef, {
          earnings: {
            todayInPaise: cur.todayInPaise + earning,
            totalInPaise: cur.totalInPaise + earning,
          },
        });
        setOtpInput('');
        Alert.alert('🎉 Delivery Complete!', `You earned ₹${Math.round(earning / 100)}`);
      }
    } catch (e) { Alert.alert('Error', e.message); }
    setActionLoading(false);
  };

  const fmt = (p) => '₹' + Math.round((p || 0) / 100);

  // ======== LOADING ========
  if (loading) {
    return (
      <SafeAreaView style={s.container}>
        <View style={s.center}><ActivityIndicator size="large" color="#10B981" /></View>
      </SafeAreaView>
    );
  }

  // ======== KYC NOT APPROVED ========
  if (!isKycApproved) {
    return (
      <SafeAreaView style={s.container}>
        <ScrollView contentContainerStyle={s.p20}>
          <Text style={s.pageTitle}>🚗 Driver Home</Text>
          <View style={s.kycBlock}>
            <Text style={{ fontSize: 56, textAlign: 'center' }}>🔒</Text>
            <Text style={s.kycBlockTitle}>
              {kycStatus === 'pending' ? '⏳ KYC Under Review' :
               kycStatus === 'rejected' ? '❌ KYC Rejected' : 'KYC Required'}
            </Text>
            <Text style={s.kycBlockDesc}>
              {kycStatus === 'pending'
                ? 'Your documents are being reviewed. Please wait.'
                : kycStatus === 'rejected'
                ? driverDoc?.kyc?.rejectionReason || 'Please resubmit your KYC.'
                : 'Complete your KYC to start accepting bookings.'}
            </Text>
            <View style={s.kycAction}>
              <Text style={s.kycActionText}>👉 Go to the "KYC" tab</Text>
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ======== ACTIVE BOOKING (OTP FLOW) ========
  if (currentBooking) {
    const st = currentBooking.status;
    return (
      <SafeAreaView style={s.container}>
        <ScrollView contentContainerStyle={s.p20}>
          <Text style={s.pageTitle}>🚚 Active Booking</Text>

          <View style={[s.statusPill, { backgroundColor: '#10B98120' }]}>
            <Text style={[s.statusPillText, { color: '#10B981' }]}>
              {st === 'accepted' ? '📍 Go to Pickup' :
               st === 'at_pickup' ? '🔑 Verify Pickup OTP' :
               st === 'in_progress' ? '🚗 Drive to Drop' :
               st === 'at_drop' ? '🔑 Verify Delivery OTP' : st}
            </Text>
          </View>

          {/* Booking Info */}
          <View style={s.card}>
            <View style={s.row}>
              <Text style={s.cardVehicle}>{VLABELS[currentBooking.vehicleType] || currentBooking.vehicleType}</Text>
              <Text style={s.cardFare}>{fmt(currentBooking.fare?.totalInPaise)}</Text>
            </View>
            {currentBooking.itemsDescription ? (
              <Text style={s.cardItems}>📦 {currentBooking.itemsDescription}</Text>
            ) : null}
            <View style={s.locBlock}>
              <Text style={s.locLabel}>📍 PICKUP</Text>
              <Text style={s.locValue}>{currentBooking.pickup?.address}</Text>
            </View>
            <View style={s.locBlock}>
              <Text style={s.locLabel}>📌 DROP</Text>
              <Text style={s.locValue}>{currentBooking.drop?.address}</Text>
            </View>
            <View style={s.locBlock}>
              <Text style={s.locLabel}>👤 CUSTOMER</Text>
              <Text style={s.locValue}>{currentBooking.customerName}</Text>
              {currentBooking.customerPhone ? (
                <TouchableOpacity style={s.callBtn} onPress={() => {
                  const n = currentBooking.customerPhone.replace(/[^0-9+]/g, '');
                  Linking.openURL(`tel:${n.startsWith('+') ? n : `+91${n}`}`);
                }}>
                  <Text style={s.callBtnText}>📞 Call {currentBooking.customerPhone}</Text>
                </TouchableOpacity>
              ) : null}
            </View>

            {/* Payment info */}
            {currentBooking.paymentMethod === 'cod' ? (
              <View style={s.codAlert}>
                <Text style={s.codAlertTitle}>💵 CASH ON DELIVERY</Text>
                <Text style={s.codAlertText}>Collect ₹{fmt(currentBooking.fare?.totalInPaise)} cash at delivery.</Text>
                <Text style={s.codAlertComm}>⚠️ Commission owed to LoadGo: {fmt(currentBooking.commission?.amountInPaise)}</Text>
              </View>
            ) : (
              <View style={s.upiAlert}>
                <Text style={s.upiAlertText}>💳 UPI — Payment is processed automatically</Text>
              </View>
            )}
          </View>

          {/* ACCEPTED → Arrive at Pickup */}
          {st === 'accepted' && (
            <View style={s.actionBox}>
              <Text style={s.actionTitle}>🚗 Drive to Pickup</Text>
              <Text style={s.actionDesc}>{currentBooking.pickup?.address}</Text>
              <TouchableOpacity style={[s.btn, actionLoading && s.btnDisabled]} onPress={() => updateBookingStatus('at_pickup')} disabled={actionLoading}>
                {actionLoading ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>📍 I've Arrived at Pickup</Text>}
              </TouchableOpacity>
            </View>
          )}

          {/* AT_PICKUP → Pickup OTP */}
          {st === 'at_pickup' && (
            <View style={[s.otpBox, { borderColor: '#3B82F6' }]}>
              <Text style={[s.otpStage, { color: '#3B82F6' }]}>STAGE 1 OF 2 — PICKUP</Text>
              <Text style={[s.otpTitle, { color: '#3B82F6' }]}>🔵 Ask customer for Pickup OTP</Text>
              <TextInput
                style={[s.otpInput, otpError && { borderColor: '#EF4444' }]}
                value={otpInput}
                onChangeText={(t) => { setOtpInput(t.replace(/[^0-9]/g, '').slice(0, 4)); setOtpError(''); }}
                placeholder="Enter 4-digit OTP"
                keyboardType="numeric" maxLength={4}
              />
              {otpError ? <Text style={s.otpErr}>{otpError}</Text> : null}
              <TouchableOpacity style={[s.btn, actionLoading && s.btnDisabled]} onPress={() => verifyOtp('pickup')} disabled={actionLoading}>
                {actionLoading ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>✅ Verify & Pickup Package</Text>}
              </TouchableOpacity>
            </View>
          )}

          {/* IN_PROGRESS → Drive to Drop */}
          {st === 'in_progress' && (
            <View style={s.actionBox}>
              <Text style={s.actionTitle}>✅ Pickup done! Drive to Drop</Text>
              <Text style={s.actionDesc}>{currentBooking.drop?.address}</Text>
              <TouchableOpacity style={[s.btn, actionLoading && s.btnDisabled]} onPress={() => updateBookingStatus('at_drop')} disabled={actionLoading}>
                {actionLoading ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>📌 I've Arrived at Drop</Text>}
              </TouchableOpacity>
            </View>
          )}

          {/* AT_DROP → Delivery OTP */}
          {st === 'at_drop' && (
            <View style={[s.otpBox, { borderColor: '#10B981' }]}>
              <Text style={[s.otpStage, { color: '#10B981' }]}>STAGE 2 OF 2 — DELIVERY</Text>
              <Text style={[s.otpTitle, { color: '#10B981' }]}>🟢 Ask customer for Delivery OTP</Text>
              <TextInput
                style={[s.otpInput, otpError && { borderColor: '#EF4444' }]}
                value={otpInput}
                onChangeText={(t) => { setOtpInput(t.replace(/[^0-9]/g, '').slice(0, 4)); setOtpError(''); }}
                placeholder="Enter 4-digit OTP"
                keyboardType="numeric" maxLength={4}
              />
              {otpError ? <Text style={s.otpErr}>{otpError}</Text> : null}
              <TouchableOpacity style={[s.btn, actionLoading && s.btnDisabled]} onPress={() => verifyOtp('delivery')} disabled={actionLoading}>
                {actionLoading ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>✅ Complete Delivery</Text>}
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ======== NORMAL HOME ========
  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <View style={{ flex: 1 }}>
          <Text style={s.pageTitle}>🚗 Driver Home</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
            {isOnline ? <OnlinePulse /> : <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: '#EF4444', marginRight: 6 }} />}
            <Text style={s.headerSub}>
              {isOnline ? 'Online' : 'Offline'}
              {myVehicle ? ` • ${VLABELS[myVehicle]}` : ''}
            </Text>
          </View>
        </View>
        <Switch value={isOnline} onValueChange={toggleOnline} trackColor={{ false: '#E5E7EB', true: '#10B981' }} />
      </View>

      {!isOnline ? (
        <View style={s.center}>
          <Text style={{ fontSize: 56 }}>😴</Text>
          <Text style={s.emptyTitle}>You're Offline</Text>
          <Text style={s.emptySub}>Go online to see and accept bookings</Text>
          <TouchableOpacity style={s.btn} onPress={toggleOnline}>
            <Text style={s.btnText}>Go Online</Text>
          </TouchableOpacity>
        </View>
      ) : availableBookings.length === 0 ? (
        <View style={s.center}>
          <Text style={{ fontSize: 56 }}>📭</Text>
          <Text style={s.emptyTitle}>No Bookings</Text>
          <Text style={s.emptySub}>
            Waiting for {myVehicle ? VLABELS[myVehicle] : ''} requests...
          </Text>
          {/* FIX: Show if there ARE searching bookings but none match vehicle */}
          {allSearching.length > 0 && !myVehicle && (
            <Text style={{ color: '#F59E0B', fontSize: 13, marginTop: 8, textAlign: 'center', paddingHorizontal: 20 }}>
              ⚠️ {allSearching.length} booking(s) available but your vehicle type is not set. Complete KYC.
            </Text>
          )}
        </View>
      ) : (
        <FlatList
          data={availableBookings}
          keyExtractor={(item) => item.id}
          contentContainerStyle={s.p20}
          ListHeaderComponent={
            <Text style={s.listHeader}>
              {availableBookings.length} {myVehicle ? VLABELS[myVehicle] : ''} booking(s) available
            </Text>
          }
          renderItem={({ item }) => (
            <View style={s.card}>
              <View style={s.row}>
                <Text style={s.cardVehicle}>{VLABELS[item.vehicleType]}</Text>
                <Text style={s.cardFare}>{fmt(item.fare?.totalInPaise)}</Text>
              </View>
              {item.itemsDescription ? (
                <Text style={s.cardItems}>📦 {item.itemsDescription}</Text>
              ) : null}
              <View style={s.locBlock}>
                <Text style={s.locLabel}>📍 Pickup</Text>
                <Text style={s.locValue} numberOfLines={2}>{item.pickup?.address}</Text>
              </View>
              <View style={s.locBlock}>
                <Text style={s.locLabel}>📌 Drop</Text>
                <Text style={s.locValue} numberOfLines={2}>{item.drop?.address}</Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 }}>
                <Text style={s.custInfo}>👤 {item.customerName} • {item.distanceKm || '?'} km</Text>
                <View style={[s.payTag, item.paymentMethod === 'cod' ? s.payTagCod : s.payTagUpi]}>
                  <Text style={s.payTagText}>{item.paymentMethod === 'cod' ? '💵 COD' : '💳 UPI'}</Text>
                </View>
              </View>
              <View style={s.btnRow}>
                <TouchableOpacity style={[s.btnAccept, actionLoading && s.btnDisabled]} onPress={() => acceptBooking(item.id)} disabled={actionLoading}>
                  {actionLoading ? <ActivityIndicator color="#fff" size="small" /> : <Text style={s.btnText}>✅ Accept</Text>}
                </TouchableOpacity>
                <TouchableOpacity style={[s.btnReject, actionLoading && s.btnDisabled]} onPress={() => rejectBooking(item.id)} disabled={actionLoading}>
                  <Text style={s.btnText}>❌ Reject</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  p20: { padding: 20, paddingBottom: 40 },
  header: { padding: 20, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#E5E7EB' },
  pageTitle: { fontSize: 22, fontWeight: '700', color: '#1F2937' },
  headerSub: { fontSize: 13, color: '#6B7280' },
  statusPill: { alignSelf: 'flex-start', paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, marginTop: 12, marginBottom: 16 },
  statusPillText: { fontSize: 13, fontWeight: '700' },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: '#1F2937', marginTop: 16 },
  emptySub: { fontSize: 14, color: '#6B7280', marginTop: 8, marginBottom: 24, textAlign: 'center' },
  listHeader: { fontSize: 13, color: '#6B7280', fontWeight: '600', marginBottom: 12 },
  // Card
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: '#E5E7EB', borderLeftWidth: 4, borderLeftColor: '#10B981' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  cardVehicle: { fontSize: 15, fontWeight: '700', color: '#1F2937' },
  cardFare: { fontSize: 20, fontWeight: '800', color: '#10B981' },
  cardItems: { fontSize: 13, fontWeight: '600', color: '#10B981', backgroundColor: '#10B98110', padding: 8, borderRadius: 8, marginBottom: 10 },
  locBlock: { paddingVertical: 6, borderTopWidth: 1, borderTopColor: '#F3F4F6' },
  locLabel: { fontSize: 11, fontWeight: '700', color: '#9CA3AF' },
  locValue: { fontSize: 14, color: '#1F2937', marginTop: 2 },
  custInfo: { fontSize: 12, color: '#6B7280' },
  payTag: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  payTagUpi: { backgroundColor: '#EFF6FF' },
  payTagCod: { backgroundColor: '#FEF3C7' },
  payTagText: { fontSize: 11, fontWeight: '600', color: '#1F2937' },
  // KYC Block
  kycBlock: { backgroundColor: '#fff', borderRadius: 16, padding: 32, marginTop: 20, borderWidth: 2, borderColor: '#F59E0B', alignItems: 'center' },
  kycBlockTitle: { fontSize: 20, fontWeight: '700', color: '#1F2937', marginTop: 12, textAlign: 'center' },
  kycBlockDesc: { fontSize: 14, color: '#6B7280', marginTop: 8, textAlign: 'center', lineHeight: 20 },
  kycAction: { backgroundColor: '#10B98115', padding: 14, borderRadius: 10, marginTop: 20, width: '100%' },
  kycActionText: { fontSize: 14, fontWeight: '600', color: '#10B981', textAlign: 'center' },
  // Payment
  codAlert: { backgroundColor: '#FEF3C7', borderWidth: 1, borderColor: '#F59E0B', borderRadius: 10, padding: 12, marginTop: 10 },
  codAlertTitle: { fontSize: 13, fontWeight: '800', color: '#92400E' },
  codAlertText: { fontSize: 13, color: '#92400E', marginTop: 4 },
  codAlertComm: { fontSize: 12, color: '#B45309', marginTop: 6, fontWeight: '600' },
  upiAlert: { backgroundColor: '#EFF6FF', borderRadius: 10, padding: 10, marginTop: 10 },
  upiAlertText: { fontSize: 13, color: '#1D4ED8', fontWeight: '500' },
  // Action box
  actionBox: { backgroundColor: '#fff', borderRadius: 12, padding: 20, marginTop: 16, borderWidth: 2, borderColor: '#3B82F6' },
  actionTitle: { fontSize: 17, fontWeight: '700', color: '#3B82F6', marginBottom: 6 },
  actionDesc: { fontSize: 14, color: '#4B5563' },
  // OTP box
  otpBox: { backgroundColor: '#fff', borderRadius: 12, padding: 20, marginTop: 16, borderWidth: 3, alignItems: 'center' },
  otpStage: { fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  otpTitle: { fontSize: 16, fontWeight: '700', marginTop: 4, textAlign: 'center' },
  otpInput: { width: '100%', borderWidth: 2, borderColor: '#E5E7EB', borderRadius: 12, padding: 16, fontSize: 28, fontWeight: '700', textAlign: 'center', letterSpacing: 10, marginTop: 16, backgroundColor: '#F9FAFB' },
  otpErr: { color: '#EF4444', fontSize: 13, fontWeight: '600', marginTop: 8 },
  // Buttons
  btn: { backgroundColor: '#10B981', padding: 16, borderRadius: 12, alignItems: 'center', marginTop: 16, width: '100%' },
  btnRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  btnAccept: { flex: 1, backgroundColor: '#10B981', padding: 14, borderRadius: 12, alignItems: 'center' },
  btnReject: { flex: 1, backgroundColor: '#EF4444', padding: 14, borderRadius: 12, alignItems: 'center' },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  callBtn: { backgroundColor: '#10B981', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 14, marginTop: 8, alignSelf: 'flex-start' },
  callBtnText: { color: '#fff', fontSize: 13, fontWeight: '600' },
});