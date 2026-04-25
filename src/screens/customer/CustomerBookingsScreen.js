import React, { useEffect, useState, useRef } from 'react';
import {
  View, Text, StyleSheet, FlatList, ActivityIndicator, Alert,
  TouchableOpacity, Linking, SectionList, Share, Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../../../firebase';
import { useAuth } from '../../contexts/AuthContext';

const ACTIVE_STATUSES = ['searching', 'accepted', 'at_pickup', 'in_progress', 'at_drop'];

function callPhone(phone) {
  if (!phone) return;
  const cleaned = phone.replace(/[^0-9+]/g, '');
  const number = cleaned.startsWith('+') ? cleaned : `+91${cleaned}`;
  Linking.openURL(`tel:${number}`).catch(() => Alert.alert('Error', 'Could not open dialer'));
}

function isBookingExpired(booking) {
  if (booking.status !== 'searching') return false;
  const createdTime = booking.createdAt?.toMillis?.() || 0;
  const nowTime = Date.now();
  const minutes = (nowTime - createdTime) / (1000 * 60);
  return minutes > 15;
}

// 📋 Share Receipt Function
async function shareReceipt(booking) {
  try {
    const totalFare = (booking.fare?.totalInPaise || 0) / 100;
    const completedDate = booking.completedAt?.toDate?.()?.toLocaleString() || 
                          booking.createdAt?.toDate?.()?.toLocaleString() || 
                          new Date().toLocaleString();
    
    const receipt = `
📦 LOADGO RECEIPT
═══════════════════════════════════════
Booking ID: ${booking.id.substring(0, 12)}...
Status: ✅ Delivered

DETAILS
─────────────────────────────────────
Vehicle: ${booking.vehicleLabel || booking.vehicleType}
Customer: ${booking.customerName || 'N/A'}
Distance: ${booking.distanceKm} km

ROUTE
─────────────────────────────────────
📍 From: ${booking.pickup?.address || 'N/A'}
📌 To: ${booking.drop?.address || 'N/A'}

${booking.driverName ? `DRIVER
─────────────────────────────────────
🚗 ${booking.driverName}
📞 ${booking.driverPhone || 'N/A'}
` : ''}
FARE BREAKDOWN
─────────────────────────────────────
Base Fare: ₹${booking.fare?.baseFare || 0}
Distance Fare: ₹${booking.fare?.distanceFare || 0}
─────────────────────────────────────
Total Amount: ₹${totalFare.toFixed(2)}
Payment: ${booking.paymentMethod === 'upi' ? '💳 UPI (Online)' : '💵 Cash on Delivery'}

═══════════════════════════════════════
Completed: ${completedDate}

Thank you for choosing LoadGo! 🙏
Track your deliveries at loadgo.app
    `.trim();

    await Share.share({
      message: receipt,
      title: `LoadGo Receipt - ${booking.id.substring(0, 8)}`,
    });
  } catch (error) {
    Alert.alert('Error', 'Could not share receipt: ' + error.message);
  }
}

export default function CustomerBookingsScreen() {
  const { user } = useAuth();
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const prevBookingsRef = useRef({});

  useEffect(() => {
    if (!user?.uid) { setLoading(false); return; }

    const q = query(
      collection(db, 'bookings'),
      where('customerId', '==', user.uid)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      data.sort((a, b) => {
        const ta = a.createdAt?.toMillis?.() || 0;
        const tb = b.createdAt?.toMillis?.() || 0;
        return tb - ta;
      });

      // Check for new driver accepted notifications
      data.forEach((booking) => {
        const prev = prevBookingsRef.current[booking.id];
        if (prev && prev.status === 'searching' && booking.status === 'accepted') {
          Alert.alert(
            '🎉 Driver Accepted!',
            `Driver: ${booking.driverName || 'Unknown'}\nMobile: ${booking.driverPhone || 'N/A'}\n\nYour driver is on the way to pickup!`
          );
        }
      });

      const stateMap = {};
      data.forEach((b) => { stateMap[b.id] = { status: b.status }; });
      prevBookingsRef.current = stateMap;

      setBookings(data);
      setLoading(false);
    }, (error) => {
      console.error('Bookings error:', error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [user?.uid]);

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#10B981" />
        </View>
      </SafeAreaView>
    );
  }

  if (bookings.length === 0) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}><Text style={styles.title}>📋 My Bookings</Text></View>
        <View style={styles.center}>
          <Text style={{ fontSize: 64 }}>📭</Text>
          <Text style={styles.emptyText}>No bookings yet</Text>
          <Text style={styles.emptySubtext}>Go to Home tab to send a parcel</Text>
        </View>
      </SafeAreaView>
    );
  }

  // Split into active and past
  const active = bookings.filter((b) => ACTIVE_STATUSES.includes(b.status));
  const past = bookings.filter((b) => !ACTIVE_STATUSES.includes(b.status));

  const sections = [];
  if (active.length > 0) sections.push({ title: '🟢 Active Bookings', data: active });
  if (past.length > 0) sections.push({ title: '📁 Past Bookings', data: past });

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>📋 My Bookings ({bookings.length})</Text>
      </View>
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        renderSectionHeader={({ section }) => (
          <Text style={styles.sectionHeader}>{section.title}</Text>
        )}
        renderItem={({ item }) => <BookingCard booking={item} />}
        stickySectionHeadersEnabled={false}
      />
    </SafeAreaView>
  );
}

function BookingCard({ booking }) {
  const getStatusInfo = () => {
    if (isBookingExpired(booking)) {
      return { color: '#EF4444', label: '⏰ Expired (No Driver Found)' };
    }
    switch (booking.status) {
      case 'searching': return { color: '#3B82F6', label: '🔍 Finding Driver' };
      case 'accepted': return { color: '#F59E0B', label: '🚗 Driver Coming to Pickup' };
      case 'at_pickup': return { color: '#8B5CF6', label: '📍 Driver at Pickup' };
      case 'in_progress': return { color: '#10B981', label: '🚚 On the Way' };
      case 'at_drop': return { color: '#10B981', label: '📌 Driver at Drop' };
      case 'completed': return { color: '#10B981', label: '✅ Delivered' };
      case 'cancelled': return { color: '#EF4444', label: '❌ Cancelled' };
      default: return { color: '#9CA3AF', label: booking.status };
    }
  };

  const VLABELS = {
    bike: '🏍️ Bike', '3wheeler': '🛺 3 Wheeler',
    chota_hatti: '🚛 Chota Hatti', tempo: '🚚 Tempo',
  };

  const { color, label } = getStatusInfo();
  const formatFare = (p) => '₹' + Math.round((p || 0) / 100);

  return (
    <View style={[styles.card, { borderLeftColor: color }]}>
      {/* Status */}
      <View style={styles.cardHeader}>
        <Text style={[styles.status, { color }]}>{label}</Text>
        <Text style={styles.fare}>{formatFare(booking.fare?.totalInPaise)}</Text>
      </View>

      {/* Vehicle & Items */}
      <Text style={styles.vehicle}>{VLABELS[booking.vehicleType] || booking.vehicleType}</Text>
      {booking.itemsDescription && (
        <Text style={styles.items}>📦 {booking.itemsDescription}</Text>
      )}

      {/* Locations */}
      <View style={styles.locations}>
        <Text style={styles.loc}>📍 {booking.pickup?.address || 'Pickup'}</Text>
        <Text style={{ textAlign: 'center', fontSize: 12 }}>⬇️</Text>
        <Text style={styles.loc}>📌 {booking.drop?.address || 'Drop'}</Text>
      </View>

      {/* Driver Info - Show when accepted */}
      {booking.driverName && booking.status !== 'searching' && (
        <View style={styles.driverBox}>
          <Text style={styles.driverLabel}>🚗 DRIVER</Text>
          <Text style={styles.driverName}>{booking.driverName}</Text>
          {booking.driverPhone ? (
            <TouchableOpacity
              style={styles.callBtn}
              onPress={() => callPhone(booking.driverPhone)}
            >
              <Text style={styles.callBtnText}>📞 Call {booking.driverPhone}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      )}

      {/* PICKUP OTP - Blue - Show at_pickup */}
      {booking.status === 'at_pickup' && booking.pickupOtp && (
        <View style={[styles.otpBox, { borderColor: '#3B82F6', backgroundColor: '#EFF6FF' }]}>
          <Text style={[styles.otpStage, { color: '#3B82F6' }]}>STAGE 1 OF 2</Text>
          <Text style={[styles.otpLabel, { color: '#3B82F6' }]}>📍 PICKUP OTP</Text>
          <Text style={[styles.otpCode, { color: '#3B82F6' }]}>{booking.pickupOtp}</Text>
          <Text style={[styles.otpHint, { color: '#3B82F6' }]}>
            Tell this code to the driver to verify pickup
          </Text>
        </View>
      )}

      {/* DELIVERY OTP - Green - Show at_drop */}
      {booking.status === 'at_drop' && booking.deliveryOtp && (
        <View style={[styles.otpBox, { borderColor: '#10B981', backgroundColor: '#ECFDF5' }]}>
          <Text style={[styles.otpStage, { color: '#10B981' }]}>STAGE 2 OF 2</Text>
          <Text style={[styles.otpLabel, { color: '#10B981' }]}>📦 DELIVERY OTP</Text>
          <Text style={[styles.otpCode, { color: '#10B981' }]}>{booking.deliveryOtp}</Text>
          <Text style={[styles.otpHint, { color: '#10B981' }]}>
            Tell this code to the driver to complete delivery
          </Text>
        </View>
      )}

      {/* Completed */}
      {booking.status === 'completed' && (
        <>
          <View style={styles.completedBox}>
            <Text style={styles.completedText}>✅ Successfully Delivered</Text>
          </View>
          
          {/* Share Receipt Button - Only for completed bookings */}
          <TouchableOpacity
            style={styles.shareReceiptBtn}
            onPress={() => shareReceipt(booking)}
          >
            <Text style={styles.shareReceiptText}>📋 Share Receipt</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  header: { padding: 20, borderBottomWidth: 1, borderBottomColor: '#E5E7EB' },
  title: { fontSize: 24, fontWeight: '700', color: '#1F2937' },
  emptyText: { fontSize: 18, fontWeight: '600', color: '#1F2937', marginTop: 16 },
  emptySubtext: { fontSize: 14, color: '#6B7280', marginTop: 8 },
  list: { padding: 16, paddingBottom: 40 },
  card: {
    backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 16,
    borderWidth: 1, borderLeftWidth: 4, borderColor: '#E5E7EB',
  },
  cardHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8,
  },
  status: { fontSize: 13, fontWeight: '700', flex: 1 },
  fare: { fontSize: 18, fontWeight: '700', color: '#10B981' },
  vehicle: { fontSize: 13, fontWeight: '600', color: '#4B5563', marginBottom: 8 },
  items: {
    fontSize: 13, color: '#10B981', fontWeight: '600',
    backgroundColor: '#10B98110', padding: 8, borderRadius: 8, marginBottom: 8,
  },
  locations: {
    paddingVertical: 8, borderTopWidth: 1, borderBottomWidth: 1, borderColor: '#F3F4F6',
  },
  loc: { fontSize: 13, color: '#1F2937', paddingVertical: 3 },
  driverBox: {
    marginTop: 12, padding: 12, backgroundColor: '#FEF3C7', borderRadius: 8,
  },
  driverLabel: { fontSize: 11, fontWeight: '700', color: '#92400E' },
  driverName: { fontSize: 15, fontWeight: '700', color: '#1F2937', marginTop: 4 },
  callBtn: {
    backgroundColor: '#10B981', borderRadius: 8, paddingVertical: 8,
    paddingHorizontal: 14, marginTop: 8, alignSelf: 'flex-start',
    flexDirection: 'row', alignItems: 'center',
  },
  callBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  sectionHeader: {
    fontSize: 16, fontWeight: '700', color: '#1F2937',
    marginBottom: 12, marginTop: 8,
  },
  otpBox: {
    borderWidth: 3, borderRadius: 12, padding: 16, marginTop: 12, alignItems: 'center',
  },
  otpStage: { fontSize: 10, fontWeight: '800', letterSpacing: 1, marginBottom: 4 },
  otpLabel: { fontSize: 13, fontWeight: '700' },
  otpCode: { fontSize: 44, fontWeight: '800', letterSpacing: 10, marginVertical: 8 },
  otpHint: { fontSize: 12, fontStyle: 'italic', textAlign: 'center' },
  completedBox: {
    marginTop: 12, padding: 12, backgroundColor: '#ECFDF5',
    borderRadius: 8, alignItems: 'center',
  },
  completedText: { fontSize: 14, fontWeight: '700', color: '#10B981' },
  shareReceiptBtn: { 
    marginTop: 10, 
    paddingVertical: 12, 
    paddingHorizontal: 16, 
    backgroundColor: '#EFF6FF', 
    borderRadius: 8, 
    borderWidth: 1.5, 
    borderColor: '#3B82F6',
    alignItems: 'center',
  },
  shareReceiptText: { fontSize: 14, fontWeight: '700', color: '#3B82F6' },
});