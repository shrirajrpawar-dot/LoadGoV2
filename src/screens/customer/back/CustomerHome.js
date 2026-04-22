import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  ScrollView, Alert, ActivityIndicator, Linking, Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { collection, addDoc, serverTimestamp, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../../../firebase';
import { useAuth } from '../../contexts/AuthContext';

const VEHICLE_TYPES = [
  { id: 'bike', label: 'Bike', icon: '🏍️', baseFare: 30, perKm: 8, capacity: '20 kg' },
  { id: '3wheeler', label: '3 Wheeler', icon: '🛺', baseFare: 50, perKm: 12, capacity: '300 kg' },
  { id: 'chota_hatti', label: 'Chota Hatti', icon: '🚛', baseFare: 70, perKm: 15, capacity: '500 kg' },
  { id: 'tempo', label: 'Tempo', icon: '🚚', baseFare: 100, perKm: 20, capacity: '1500 kg' },
];

const ACTIVE_STATUSES = ['searching', 'accepted', 'at_pickup', 'in_progress', 'at_drop'];

function getStatusColor(status) {
  switch (status) {
    case 'searching': return '#3B82F6';
    case 'accepted': return '#F59E0B';
    case 'at_pickup': return '#8B5CF6';
    case 'in_progress': return '#10B981';
    case 'at_drop': return '#10B981';
    default: return '#9CA3AF';
  }
}

function getStatusLabel(status) {
  switch (status) {
    case 'searching': return 'Finding Driver';
    case 'accepted': return '🚗 Driver Coming';
    case 'at_pickup': return '📍 Driver at Pickup';
    case 'in_progress': return '🚚 On the Way';
    case 'at_drop': return '📌 Driver at Drop';
    default: return status;
  }
}

// Pulsing dot for active status
function PulsingDot({ color = '#3B82F6' }) {
  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(scale, { toValue: 1.8, duration: 700, useNativeDriver: true }),
          Animated.timing(scale, { toValue: 1, duration: 700, useNativeDriver: true }),
        ]),
        Animated.sequence([
          Animated.timing(opacity, { toValue: 0.2, duration: 700, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
        ]),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, []);

  return (
    <Animated.View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: color, opacity, transform: [{ scale }] }} />
  );
}

// Bouncing dots for "Finding Driver"
function FindingDriverAnimation() {
  const dots = [useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current];

  useEffect(() => {
    const anims = dots.map((dot, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 150),
          Animated.timing(dot, { toValue: -10, duration: 350, useNativeDriver: true }),
          Animated.timing(dot, { toValue: 0, duration: 350, useNativeDriver: true }),
          Animated.delay(450),
        ])
      )
    );
    Animated.parallel(anims).start();
    return () => anims.forEach((a) => a.stop());
  }, []);

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 12 }}>
      {dots.map((dot, i) => (
        <Animated.View
          key={i}
          style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: '#3B82F6', marginHorizontal: 5, transform: [{ translateY: dot }] }}
        />
      ))}
    </View>
  );
}

export default function CustomerHome() {
  const { user, profile } = useAuth();
  const [showBookingForm, setShowBookingForm] = useState(false);
  const [selectedVehicle, setSelectedVehicle] = useState('chota_hatti');
  const [pickupAddress, setPickupAddress] = useState('');
  const [dropAddress, setDropAddress] = useState('');
  const [itemsDescription, setItemsDescription] = useState('');
  const [distance, setDistance] = useState(5);
  const [paymentMethod, setPaymentMethod] = useState('upi');
  const [loading, setLoading] = useState(false);
  const [activeBookings, setActiveBookings] = useState([]); // FIX: plural — show all

  useEffect(() => {
    if (!user?.uid) return;
    const q = query(collection(db, 'bookings'), where('customerId', '==', user.uid));
    const unsub = onSnapshot(q, (snap) => {
      const bookings = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      // FIX: filter ALL active bookings, not just the first one
      const active = bookings.filter((b) => ACTIVE_STATUSES.includes(b.status));
      setActiveBookings(active);
    });
    return () => unsub();
  }, [user?.uid]);

  const vehicle = VEHICLE_TYPES.find((v) => v.id === selectedVehicle);
  const baseFare = vehicle.baseFare * 100;
  const distanceFare = distance * vehicle.perKm * 100;
  const totalFare = baseFare + distanceFare;
  const commission = Math.round(totalFare * (settings.commissionPct / 100));
  const generateOtp = () => Math.floor(1000 + Math.random() * 9000).toString();

  const handleBooking = async () => {
    if (!pickupAddress.trim()) { Alert.alert('Required', 'Enter pickup address'); return; }
    if (!dropAddress.trim()) { Alert.alert('Required', 'Enter drop address'); return; }
    if (!itemsDescription.trim()) { Alert.alert('Required', 'Describe your items'); return; }

    setLoading(true);
    try {
      await addDoc(collection(db, 'bookings'), {
        customerId: user.uid,
        customerName: profile?.name || 'Customer',
        customerPhone: profile?.phone || '',
        vehicleType: selectedVehicle,
        vehicleLabel: vehicle.label,
        pickup: { address: pickupAddress.trim() },
        drop: { address: dropAddress.trim() },
        itemsDescription: itemsDescription.trim(),
        distanceKm: distance,
        fare: { baseFare, distanceFare, totalInPaise: totalFare },
        paymentMethod,
        // Commission tracking: UPI = already paid, COD = driver owes company
        commission: {
          amountInPaise: commission,
          status: paymentMethod === 'upi' ? 'collected' : 'pending_from_driver',
        },
        status: 'searching',
        pickupOtp: generateOtp(),
        deliveryOtp: generateOtp(),
        createdAt: serverTimestamp(),
      });

      Alert.alert(
        '✅ Booking Created!',
        `Fare: ₹${totalFare / 100}\nPayment: ${paymentMethod === 'upi' ? '💳 UPI' : '💵 Cash on Delivery'}`
      );
      setShowBookingForm(false);
      setPickupAddress(''); setDropAddress(''); setItemsDescription('');
      setDistance(5); setPaymentMethod('upi');
    } catch (error) {
      Alert.alert('Error', error.message);
    } finally {
      setLoading(false);
    }
  };

  // ---- BOOKING FORM ----
  if (showBookingForm) {
    return (
      <SafeAreaView style={s.container}>
        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
          <TouchableOpacity onPress={() => setShowBookingForm(false)}>
            <Text style={s.backBtn}>← Back</Text>
          </TouchableOpacity>
          <Text style={s.formTitle}>📦 Send a Parcel</Text>

          <Text style={s.label}>SELECT VEHICLE</Text>
          <View style={s.vehicleGrid}>
            {VEHICLE_TYPES.filter(v => v.enabled !== false).map((v) => (
              <TouchableOpacity key={v.id}
                style={[s.vehicleCard, selectedVehicle === v.id && s.vehicleSelected]}
                onPress={() => setSelectedVehicle(v.id)}>
                <Text style={{ fontSize: 28 }}>{v.icon}</Text>
                <Text style={s.vehicleName}>{v.label}</Text>
                <Text style={s.vehicleCap}>{v.capacity}</Text>
                <Text style={s.vehiclePrice}>₹{v.baseFare}+</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={s.label}>WHAT ARE YOU SENDING? *</Text>
          <TextInput style={s.textarea} value={itemsDescription} onChangeText={setItemsDescription}
            placeholder="e.g., Furniture, boxes, documents..." multiline numberOfLines={3} />

          <Text style={s.label}>PICKUP ADDRESS *</Text>
          <TextInput style={s.input} value={pickupAddress} onChangeText={setPickupAddress} placeholder="Enter pickup location" />

          <Text style={s.label}>DROP ADDRESS *</Text>
          <TextInput style={s.input} value={dropAddress} onChangeText={setDropAddress} placeholder="Enter drop location" />

          <Text style={s.label}>DISTANCE (KM)</Text>
          <View style={s.distRow}>
            <TouchableOpacity style={s.distBtn} onPress={() => setDistance(Math.max(1, distance - 1))}>
              <Text style={s.distBtnText}>−</Text>
            </TouchableOpacity>
            <Text style={s.distVal}>{distance} km</Text>
            <TouchableOpacity style={s.distBtn} onPress={() => setDistance(distance + 1)}>
              <Text style={s.distBtnText}>+</Text>
            </TouchableOpacity>
          </View>

          {/* PAYMENT METHOD */}
          <Text style={s.label}>PAYMENT METHOD</Text>
          <View style={s.payRow}>
            <TouchableOpacity style={[s.payBtn, paymentMethod === 'upi' && s.payBtnActive]} onPress={() => setPaymentMethod('upi')}>
              <Text style={{ fontSize: 28 }}>💳</Text>
              <Text style={[s.payLabel, paymentMethod === 'upi' && { color: '#10B981' }]}>UPI</Text>
              <Text style={s.paySub}>Pay online</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.payBtn, paymentMethod === 'cod' && s.payBtnActive]} onPress={() => setPaymentMethod('cod')}>
              <Text style={{ fontSize: 28 }}>💵</Text>
              <Text style={[s.payLabel, paymentMethod === 'cod' && { color: '#10B981' }]}>Cash</Text>
              <Text style={s.paySub}>Pay on delivery</Text>
            </TouchableOpacity>
          </View>

          {paymentMethod === 'cod' && (
            <View style={s.codNote}>
              <Text style={s.codNoteText}>💵 Pay ₹{totalFare / 100} cash to driver at delivery</Text>
            </View>
          )}

          {/* FARE */}
          <View style={s.fareBox}>
            <FareRow label="Base Fare" value={`₹${baseFare / 100}`} />
            <FareRow label={`Distance (${distance}km × ₹${vehicle.perKm})`} value={`₹${distanceFare / 100}`} />
            <View style={s.divider} />
            <FareRow label="Total" value={`₹${totalFare / 100}`} bold />
            <FareRow label="Payment" value={paymentMethod === 'upi' ? '💳 UPI' : '💵 Cash'} highlight />
          </View>

          <TouchableOpacity style={[s.confirmBtn, loading && { opacity: 0.6 }]} onPress={handleBooking} disabled={loading}>
            {loading ? <ActivityIndicator color="#fff" /> :
              <Text style={s.confirmBtnText}>{paymentMethod === 'upi' ? '💳' : '💵'} Confirm — ₹{totalFare / 100}</Text>}
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ---- HOME SCREEN ----
  return (
    <SafeAreaView style={s.container}>
      <ScrollView contentContainerStyle={s.homeScroll}>
        <View style={s.homeHeader}>
          <Text style={s.greeting}>Hi {profile?.name || 'there'}! 👋</Text>
          <Text style={s.appTitle}>LoadGo</Text>
        </View>

        <TouchableOpacity style={s.sendBtn} onPress={() => setShowBookingForm(true)}>
          <Text style={{ fontSize: 40, marginRight: 16 }}>📦</Text>
          <View style={{ flex: 1 }}>
            <Text style={s.sendTitle}>Send a Parcel</Text>
            <Text style={s.sendDesc}>Book a delivery now</Text>
          </View>
          <Text style={{ fontSize: 24, color: '#fff', fontWeight: '700' }}>→</Text>
        </TouchableOpacity>

        {/* ACTIVE BOOKINGS — show ALL of them */}
        {activeBookings.length > 0 && (
          <View>
            <Text style={s.activeSectionTitle}>
              🚚 Active Bookings ({activeBookings.length})
            </Text>
            {activeBookings.map((activeBooking) => (
              <View key={activeBooking.id} style={[s.activeCard, { borderLeftColor: getStatusColor(activeBooking.status) }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <PulsingDot color={getStatusColor(activeBooking.status)} />
                  <Text style={[s.activeStatus, { color: getStatusColor(activeBooking.status) }]}>
                    {getStatusLabel(activeBooking.status)}
                  </Text>
                  <Text style={s.vehicleBadge}>{activeBooking.vehicleLabel}</Text>
                </View>
                {activeBooking.status === 'searching' && <FindingDriverAnimation />}
                {activeBooking.driverName && activeBooking.status !== 'searching' && (
                  <>
                    <Text style={s.driverInfo}>🚗 {activeBooking.driverName}</Text>
                    {activeBooking.driverPhone ? (
                      <TouchableOpacity style={s.callLink} onPress={() => {
                        const n = activeBooking.driverPhone.replace(/[^0-9+]/g, '');
                        Linking.openURL(`tel:${n.startsWith('+') ? n : `+91${n}`}`);
                      }}>
                        <Text style={s.callText}>📞 Call {activeBooking.driverPhone}</Text>
                      </TouchableOpacity>
                    ) : null}
                  </>
                )}
                <View style={s.payBadge}>
                  <Text style={s.payBadgeText}>
                    {activeBooking.paymentMethod === 'cod' ? '💵 Cash on Delivery' : '💳 UPI'}
                    {' '}• ₹{Math.round((activeBooking.fare?.totalInPaise || 0) / 100)}
                  </Text>
                </View>
                {activeBooking.status === 'at_pickup' && activeBooking.pickupOtp && (
                  <View style={[s.otpBox, { borderColor: '#3B82F6', backgroundColor: '#EFF6FF' }]}>
                    <Text style={[s.otpLabel, { color: '#3B82F6' }]}>🔵 PICKUP OTP — Tell driver</Text>
                    <Text style={[s.otpCode, { color: '#3B82F6' }]}>{activeBooking.pickupOtp}</Text>
                  </View>
                )}
                {activeBooking.status === 'at_drop' && activeBooking.deliveryOtp && (
                  <View style={[s.otpBox, { borderColor: '#10B981', backgroundColor: '#ECFDF5' }]}>
                    <Text style={[s.otpLabel, { color: '#10B981' }]}>🟢 DELIVERY OTP — Tell driver</Text>
                    <Text style={[s.otpCode, { color: '#10B981' }]}>{activeBooking.deliveryOtp}</Text>
                  </View>
                )}
              </View>
            ))}
          </View>
        )}

        {/* Vehicles list */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Available Vehicles</Text>
          {VEHICLE_TYPES.filter(v => v.enabled !== false).map((v) => (
            <View key={v.id} style={s.vRow}>
              <Text style={{ fontSize: 28 }}>{v.icon}</Text>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={s.vName}>{v.label}</Text>
                <Text style={s.vCap}>Up to {v.capacity}</Text>
              </View>
              <Text style={s.vPrice}>₹{v.baseFare}+</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function FareRow({ label, value, bold, highlight }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5 }}>
      <Text style={{ fontSize: 13, color: '#6B7280' }}>{label}</Text>
      <Text style={{ fontSize: bold ? 16 : 13, fontWeight: bold ? '700' : '400', color: highlight ? '#10B981' : '#1F2937' }}>
        {value}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  scroll: { padding: 20, paddingBottom: 40 },
  homeScroll: { padding: 20, paddingBottom: 40 },
  backBtn: { fontSize: 16, color: '#10B981', fontWeight: '600', marginBottom: 16 },
  homeHeader: { marginBottom: 24 },
  greeting: { fontSize: 16, color: '#6B7280' },
  appTitle: { fontSize: 32, fontWeight: '800', color: '#1F2937' },
  sendBtn: {
    backgroundColor: '#10B981', borderRadius: 16, padding: 20, marginBottom: 20,
    flexDirection: 'row', alignItems: 'center',
    shadowColor: '#10B981', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 6,
  },
  sendTitle: { fontSize: 20, fontWeight: '700', color: '#fff' },
  sendDesc: { fontSize: 14, color: '#D1FAE5', marginTop: 4 },
  // Active booking
  activeCard: {
    backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 20,
    borderWidth: 1, borderLeftWidth: 4, borderColor: '#E5E7EB',
  },
  activeSectionTitle: { fontSize: 16, fontWeight: '700', color: '#1F2937', marginBottom: 10 },
  vehicleBadge: { fontSize: 11, color: '#6B7280', backgroundColor: '#F3F4F6', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  activeTitle: { fontSize: 15, fontWeight: '700', color: '#1F2937', marginBottom: 8 },
  activeStatus: { fontSize: 14, fontWeight: '700' },
  driverInfo: { fontSize: 14, fontWeight: '600', color: '#1F2937', marginTop: 8 },
  callLink: { backgroundColor: '#10B98115', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, marginTop: 6, alignSelf: 'flex-start' },
  callText: { fontSize: 13, fontWeight: '600', color: '#10B981' },
  payBadge: { backgroundColor: '#F3F4F6', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, alignSelf: 'flex-start', marginTop: 8 },
  payBadgeText: { fontSize: 12, fontWeight: '600', color: '#4B5563' },
  otpBox: { borderWidth: 2, borderRadius: 10, padding: 12, alignItems: 'center', marginTop: 10 },
  otpLabel: { fontSize: 11, fontWeight: '700', marginBottom: 4 },
  otpCode: { fontSize: 30, fontWeight: '800', letterSpacing: 8 },
  // Section
  section: { backgroundColor: '#fff', borderRadius: 12, padding: 16, borderWidth: 1, borderColor: '#E5E7EB', marginBottom: 20 },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: '#1F2937', marginBottom: 16 },
  vRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderTopWidth: 1, borderTopColor: '#F3F4F6' },
  vName: { fontSize: 15, fontWeight: '600', color: '#1F2937' },
  vCap: { fontSize: 12, color: '#6B7280', marginTop: 2 },
  vPrice: { fontSize: 16, fontWeight: '700', color: '#10B981' },
  // Form
  formTitle: { fontSize: 24, fontWeight: '700', color: '#1F2937', marginBottom: 20 },
  label: { fontSize: 12, fontWeight: '700', color: '#6B7280', marginBottom: 8, marginTop: 16, letterSpacing: 0.5 },
  vehicleGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  vehicleCard: { flex: 1, minWidth: '45%', backgroundColor: '#fff', borderWidth: 2, borderColor: '#E5E7EB', borderRadius: 12, padding: 14, alignItems: 'center' },
  vehicleSelected: { borderColor: '#10B981', backgroundColor: '#10B98115' },
  vehicleName: { fontSize: 13, fontWeight: '600', color: '#1F2937', marginTop: 4 },
  vehicleCap: { fontSize: 10, color: '#6B7280', marginTop: 2 },
  vehiclePrice: { fontSize: 12, fontWeight: '700', color: '#10B981', marginTop: 4 },
  textarea: { backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#E5E7EB', borderRadius: 12, padding: 12, fontSize: 14, minHeight: 70, textAlignVertical: 'top' },
  input: { backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#E5E7EB', borderRadius: 12, padding: 12, fontSize: 14 },
  distRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  distBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#10B981', justifyContent: 'center', alignItems: 'center' },
  distBtnText: { color: '#fff', fontSize: 22, fontWeight: '700' },
  distVal: { flex: 1, fontSize: 20, fontWeight: '700', textAlign: 'center', color: '#1F2937' },
  payRow: { flexDirection: 'row', gap: 12 },
  payBtn: { flex: 1, backgroundColor: '#fff', borderWidth: 2, borderColor: '#E5E7EB', borderRadius: 12, padding: 16, alignItems: 'center' },
  payBtnActive: { borderColor: '#10B981', backgroundColor: '#10B98110' },
  payLabel: { fontSize: 15, fontWeight: '700', color: '#1F2937', marginTop: 4 },
  paySub: { fontSize: 11, color: '#6B7280', marginTop: 2 },
  codNote: { backgroundColor: '#FEF3C7', borderWidth: 1, borderColor: '#F59E0B', borderRadius: 10, padding: 12, marginTop: 10 },
  codNoteText: { fontSize: 13, color: '#92400E', fontWeight: '500' },
  fareBox: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginTop: 20, borderWidth: 1, borderColor: '#E5E7EB' },
  divider: { height: 1, backgroundColor: '#E5E7EB', marginVertical: 8 },
  confirmBtn: { backgroundColor: '#10B981', borderRadius: 12, paddingVertical: 16, alignItems: 'center', marginTop: 24 },
  confirmBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});