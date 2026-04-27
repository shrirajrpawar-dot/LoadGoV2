import React, { useEffect, useState, useRef } from 'react';
import {
  View, Text, StyleSheet, FlatList, ActivityIndicator, Alert,
  TouchableOpacity, Linking, SectionList, Share, Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { collection, query, where, onSnapshot, limit } from 'firebase/firestore';
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
function buildInvoiceHTML(booking) {
  const totalFare = (booking.fare?.totalInPaise || 0) / 100;
  const baseFare = Math.round((booking.fare?.baseFare || 0) / 100);
  const distanceFare = Math.round((booking.fare?.distanceFare || 0) / 100);
  const completedDate = booking.completedAt?.toDate?.()?.toLocaleString() ||
                        booking.createdAt?.toDate?.()?.toLocaleString() ||
                        new Date().toLocaleString();
  const bookingShortId = booking.id.substring(0, 12).toUpperCase();
  const paymentLabel = booking.paymentMethod === 'upi' ? 'UPI (Online)' : 'Cash on Delivery';
  const escape = (s) => String(s || '').replace(/[<>&"]/g, c => ({ '<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;' }[c]));

  return `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8" />
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, "Helvetica Neue", Arial, sans-serif; color: #111827; padding: 36px 32px; background: #FFFFFF; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 24px; border-bottom: 1px solid #E5E7EB; }
  .brand-block { }
  .brand-logo { width: 44px; height: 44px; background: #111827; color: #FFFFFF; border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 22px; font-weight: 900; letter-spacing: -1px; margin-bottom: 12px; }
  .brand-name { font-size: 20px; font-weight: 800; color: #111827; }
  .brand-tag { font-size: 12px; color: #6B7280; margin-top: 2px; }
  .invoice-meta { text-align: right; }
  .invoice-label { font-size: 10px; color: #9CA3AF; font-weight: 700; letter-spacing: 0.8px; }
  .invoice-no { font-size: 14px; color: #111827; font-weight: 700; margin-top: 4px; font-family: ui-monospace, monospace; }
  .invoice-date { font-size: 11px; color: #6B7280; margin-top: 6px; }
  .status-pill { display: inline-block; background: #ECFDF5; color: #065F46; padding: 4px 12px; border-radius: 999px; font-size: 11px; font-weight: 700; margin-top: 10px; }

  .section { margin-top: 28px; }
  .section-label { font-size: 10px; color: #6B7280; font-weight: 800; letter-spacing: 0.8px; margin-bottom: 12px; }
  .row-grid { display: flex; gap: 24px; }
  .col { flex: 1; }
  .row-label { font-size: 11px; color: #9CA3AF; font-weight: 600; }
  .row-value { font-size: 13px; color: #111827; font-weight: 600; margin-top: 3px; }

  .route-card { background: #F9FAFB; border: 1px solid #F3F4F6; border-radius: 14px; padding: 16px; }
  .stop { display: flex; gap: 12px; padding: 4px 0; }
  .stop-marker-green { width: 10px; height: 10px; border-radius: 5px; background: #10B981; margin-top: 6px; flex-shrink: 0; }
  .stop-marker-red { width: 10px; height: 10px; border-radius: 2px; background: #EF4444; margin-top: 6px; flex-shrink: 0; }
  .stop-text { font-size: 12px; color: #374151; line-height: 1.5; }
  .stop-divider { height: 14px; width: 1px; background: #D1D5DB; margin-left: 4px; }

  .fare-table { width: 100%; border-collapse: collapse; margin-top: 6px; }
  .fare-table td { padding: 10px 0; font-size: 13px; }
  .fare-table td:last-child { text-align: right; font-weight: 600; color: #111827; }
  .fare-table .desc { color: #6B7280; }
  .fare-table tr.divider td { padding: 0; }
  .fare-table tr.divider hr { border: none; height: 1px; background: #E5E7EB; }
  .fare-table tr.total td { padding-top: 14px; font-size: 16px; font-weight: 800; }
  .fare-table tr.total td:last-child { color: #10B981; }

  .payment-row { display: flex; justify-content: space-between; align-items: center; background: #F9FAFB; border: 1px solid #F3F4F6; border-radius: 12px; padding: 14px 16px; margin-top: 16px; }
  .payment-label { font-size: 11px; color: #6B7280; font-weight: 700; }
  .payment-value { font-size: 13px; color: #111827; font-weight: 700; }

  .footer { margin-top: 36px; padding-top: 20px; border-top: 1px solid #E5E7EB; text-align: center; }
  .thanks { font-size: 14px; color: #111827; font-weight: 700; }
  .footnote { font-size: 11px; color: #9CA3AF; margin-top: 6px; }
</style>
</head>
<body>
  <div class="header">
    <div class="brand-block">
      <div class="brand-logo">L</div>
      <div class="brand-name">Sarthi</div>
      <div class="brand-tag">Fast Delivery, Anywhere</div>
    </div>
    <div class="invoice-meta">
      <div class="invoice-label">RECEIPT</div>
      <div class="invoice-no">#${escape(bookingShortId)}</div>
      <div class="invoice-date">${escape(completedDate)}</div>
      <div class="status-pill">Delivered</div>
    </div>
  </div>

  <div class="section">
    <div class="section-label">TRIP DETAILS</div>
    <div class="row-grid">
      <div class="col">
        <div class="row-label">Customer</div>
        <div class="row-value">${escape(booking.customerName || '—')}</div>
      </div>
      <div class="col">
        <div class="row-label">Vehicle</div>
        <div class="row-value">${escape(booking.vehicleLabel || booking.vehicleType || '—')}</div>
      </div>
      <div class="col">
        <div class="row-label">Distance</div>
        <div class="row-value">${escape(booking.distanceKm || '—')} km</div>
      </div>
      ${booking.driverName ? `<div class="col"><div class="row-label">Driver</div><div class="row-value">${escape(booking.driverName)}</div></div>` : ''}
    </div>
  </div>

  <div class="section">
    <div class="section-label">ROUTE</div>
    <div class="route-card">
      <div class="stop">
        <div class="stop-marker-green"></div>
        <div class="stop-text">${escape(booking.pickup?.address || '—')}</div>
      </div>
      <div class="stop-divider"></div>
      <div class="stop">
        <div class="stop-marker-red"></div>
        <div class="stop-text">${escape(booking.drop?.address || '—')}</div>
      </div>
    </div>
  </div>

  <div class="section">
    <div class="section-label">FARE BREAKDOWN</div>
    <table class="fare-table">
      <tr>
        <td class="desc">Base Fare</td>
        <td>₹${baseFare}</td>
      </tr>
      <tr>
        <td class="desc">Distance${booking.distanceKm ? ` (${booking.distanceKm} km)` : ''}</td>
        <td>₹${distanceFare}</td>
      </tr>
      <tr class="divider"><td colspan="2"><hr/></td></tr>
      <tr class="total">
        <td>Total Amount</td>
        <td>₹${totalFare.toFixed(2)}</td>
      </tr>
    </table>

    <div class="payment-row">
      <div class="payment-label">PAYMENT METHOD</div>
      <div class="payment-value">${escape(paymentLabel)}</div>
    </div>
  </div>

  <div class="footer">
    <div class="thanks">Thank you for choosing Sarthi</div>
    <div class="footnote">For support, contact us at support@sarthi.app</div>
  </div>
</body>
</html>
  `;
}

async function shareReceipt(booking) {
  try {
    const html = buildInvoiceHTML(booking);
    const { uri } = await Print.printToFileAsync({ html, base64: false });

    const isAvailable = await Sharing.isAvailableAsync();
    if (isAvailable) {
      await Sharing.shareAsync(uri, {
        mimeType: 'application/pdf',
        dialogTitle: `Sarthi Receipt - ${booking.id.substring(0, 8)}`,
        UTI: 'com.adobe.pdf',
      });
    } else {
      Alert.alert('PDF Saved', `Receipt saved to: ${uri}`);
    }
  } catch (error) {
    Alert.alert('Error', 'Could not generate receipt: ' + error.message);
  }
}

export default function CustomerBookingsScreen() {
  const { user } = useAuth();
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pageSize, setPageSize] = useState(30);
  const [hasMore, setHasMore] = useState(false);
  const prevBookingsRef = useRef({});

  useEffect(() => {
    if (!user?.uid) { setLoading(false); return; }

    const q = query(
      collection(db, 'bookings'),
      where('customerId', '==', user.uid),
      limit(pageSize + 1)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const all = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      all.sort((a, b) => {
        const ta = a.createdAt?.toMillis?.() || 0;
        const tb = b.createdAt?.toMillis?.() || 0;
        return tb - ta;
      });
      setHasMore(all.length > pageSize);
      const data = all.slice(0, pageSize);

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
  }, [user?.uid, pageSize]);

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
        <View style={styles.header}><Text style={styles.title}>My Bookings</Text></View>
        <View style={styles.center}>
          <View style={styles.emptyIconCircle}>
            <Ionicons name="receipt-outline" size={42} color="#9CA3AF" />
          </View>
          <Text style={styles.emptyText}>No bookings yet</Text>
          <Text style={styles.emptySubtext}>Go to Home tab to send a parcel or book a ride</Text>
        </View>
      </SafeAreaView>
    );
  }

  // Split into active and past
  const active = bookings.filter((b) => ACTIVE_STATUSES.includes(b.status));
  const past = bookings.filter((b) => !ACTIVE_STATUSES.includes(b.status));

  const sections = [];
  if (active.length > 0) sections.push({ title: 'Active', data: active });
  if (past.length > 0) sections.push({ title: 'Past', data: past });

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>My Bookings</Text>
        <Text style={styles.subtitle}>
          {hasMore ? `Showing ${bookings.length}` : `${bookings.length} total`}
        </Text>
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
        ListFooterComponent={hasMore ? (
          <TouchableOpacity
            style={styles.loadMoreBtn}
            onPress={() => setPageSize(pageSize + 30)}
          >
            <Ionicons name="chevron-down" size={16} color="#374151" />
            <Text style={styles.loadMoreText}>Load More</Text>
          </TouchableOpacity>
        ) : null}
      />
    </SafeAreaView>
  );
}

function BookingCard({ booking }) {
  const getStatusInfo = () => {
    if (isBookingExpired(booking)) {
      return { color: '#EF4444', label: 'Expired (No Driver Found)', icon: 'time-outline' };
    }
    switch (booking.status) {
      case 'searching': return { color: '#3B82F6', label: 'Finding Driver', icon: 'search-outline' };
      case 'accepted': return { color: '#F59E0B', label: 'Driver Coming to Pickup', icon: 'car-outline' };
      case 'at_pickup': return { color: '#8B5CF6', label: 'Driver at Pickup', icon: 'location-outline' };
      case 'in_progress': return { color: '#10B981', label: 'On the Way', icon: 'navigate-outline' };
      case 'at_drop': return { color: '#10B981', label: 'Driver at Drop', icon: 'flag-outline' };
      case 'completed': return { color: '#10B981', label: 'Delivered', icon: 'checkmark-circle' };
      case 'cancelled': return { color: '#EF4444', label: 'Cancelled', icon: 'close-circle' };
      default: return { color: '#9CA3AF', label: booking.status, icon: 'ellipse-outline' };
    }
  };

  const VLABELS = {
    bike: '🏍️ Bike', '3wheeler': '🛺 3 Wheeler Rickshaw', '3wheeler_transport': '🛺 3 Wheeler Transport',
    chota_hatti: '🚛 Chota Hatti', tempo: '🚚 Tempo',
    sedan: '🚗 Sedan', hatchback: '🚙 Hatchback', '7_seater': '🚐 7 Seater',
  };

  const { color, label, icon } = getStatusInfo();
  const formatFare = (p) => '₹' + Math.round((p || 0) / 100);

  return (
    <View style={styles.card}>
      {/* Status pill + fare */}
      <View style={styles.cardHeader}>
        <View style={[styles.statusPill, { backgroundColor: color + '15' }]}>
          <Ionicons name={icon} size={14} color={color} />
          <Text style={[styles.statusPillText, { color }]}>{label}</Text>
        </View>
        <Text style={styles.fare}>{formatFare(booking.fare?.totalInPaise)}</Text>
      </View>

      {/* Vehicle */}
      <Text style={styles.vehicle}>{VLABELS[booking.vehicleType] || booking.vehicleType}</Text>

      {/* Items */}
      {booking.itemsDescription ? (
        <View style={styles.itemsBox}>
          <Ionicons name="cube-outline" size={14} color="#10B981" />
          <Text style={styles.itemsText} numberOfLines={1}>{booking.itemsDescription}</Text>
        </View>
      ) : null}

      {/* Pickup / Drop with dots */}
      <View style={styles.routeBox}>
        <View style={styles.routeRow}>
          <View style={styles.greenDot} />
          <Text style={styles.routeText} numberOfLines={3}>{booking.pickup?.address || 'Pickup'}</Text>
        </View>
        <View style={styles.routeDivider} />
        <View style={styles.routeRow}>
          <View style={styles.redSquare} />
          <Text style={styles.routeText} numberOfLines={3}>{booking.drop?.address || 'Drop'}</Text>
        </View>
      </View>

      {/* Driver Info - Show only during active trip; hidden after completion/cancellation */}
      {booking.driverName &&
        !['searching', 'completed', 'cancelled', 'cancelled_by_customer'].includes(booking.status) && (
        <View style={styles.driverBox}>
          <View style={styles.driverInfoRow}>
            <View style={styles.driverAvatar}>
              <Ionicons name="person" size={20} color="#92400E" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.driverLabel}>DRIVER</Text>
              <Text style={styles.driverName}>{booking.driverName}</Text>
            </View>
          </View>
          {booking.driverPhone ? (
            <TouchableOpacity
              style={styles.callBtn}
              onPress={() => callPhone(booking.driverPhone)}
            >
              <Ionicons name="call" size={16} color="#FFF" />
              <Text style={styles.callBtnText}>Call {booking.driverPhone}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      )}

      {/* PICKUP OTP */}
      {booking.status === 'at_pickup' && booking.pickupOtp && (
        <View style={[styles.otpBox, { borderColor: '#3B82F6', backgroundColor: '#EFF6FF' }]}>
          <Text style={[styles.otpStage, { color: '#3B82F6' }]}>STAGE 1 OF 2</Text>
          <Text style={[styles.otpLabel, { color: '#3B82F6' }]}>PICKUP OTP</Text>
          <Text style={[styles.otpCode, { color: '#3B82F6' }]}>{booking.pickupOtp}</Text>
          <Text style={[styles.otpHint, { color: '#3B82F6' }]}>
            Tell this code to the driver to verify pickup
          </Text>
        </View>
      )}

      {/* DELIVERY OTP */}
      {booking.status === 'at_drop' && booking.deliveryOtp && (
        <View style={[styles.otpBox, { borderColor: '#10B981', backgroundColor: '#ECFDF5' }]}>
          <Text style={[styles.otpStage, { color: '#10B981' }]}>STAGE 2 OF 2</Text>
          <Text style={[styles.otpLabel, { color: '#10B981' }]}>DELIVERY OTP</Text>
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
            <Ionicons name="checkmark-circle" size={18} color="#10B981" />
            <Text style={styles.completedText}>Successfully Delivered</Text>
          </View>
          <TouchableOpacity
            style={styles.shareReceiptBtn}
            onPress={() => shareReceipt(booking)}
          >
            <Ionicons name="share-outline" size={18} color="#3B82F6" />
            <Text style={styles.shareReceiptText}>Share Receipt</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F3F4F6' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  header: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 18, backgroundColor: '#FFFFFF' },
  title: { fontSize: 26, fontWeight: '800', color: '#111827' },
  subtitle: { fontSize: 13, color: '#6B7280', fontWeight: '600', marginTop: 2 },
  emptyIconCircle: { width: 96, height: 96, borderRadius: 48, backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  emptyText: { fontSize: 18, fontWeight: '700', color: '#111827', marginTop: 4 },
  emptySubtext: { fontSize: 14, color: '#6B7280', marginTop: 6, textAlign: 'center' },
  list: { padding: 16, paddingBottom: 40 },

  sectionHeader: { fontSize: 14, fontWeight: '800', color: '#6B7280', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10, marginTop: 6 },

  card: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 16, marginBottom: 14, borderWidth: 1, borderColor: '#F3F4F6', shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2 },

  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20 },
  statusPillText: { fontSize: 12, fontWeight: '700' },
  fare: { fontSize: 20, fontWeight: '800', color: '#111827' },

  vehicle: { fontSize: 13, fontWeight: '700', color: '#374151', marginBottom: 10 },

  itemsBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#10B98115', paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10, marginBottom: 10 },
  itemsText: { flex: 1, fontSize: 13, color: '#065F46', fontWeight: '600' },

  routeBox: { backgroundColor: '#F9FAFB', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#F3F4F6' },
  routeRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  greenDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#10B981', marginTop: 5 },
  redSquare: { width: 10, height: 10, borderRadius: 3, backgroundColor: '#EF4444', marginTop: 5 },
  routeText: { flex: 1, fontSize: 13, color: '#374151', fontWeight: '500' },
  routeDivider: { height: 12, width: 2, backgroundColor: '#E5E7EB', marginLeft: 4, marginVertical: 2 },

  driverBox: { marginTop: 12, padding: 14, backgroundColor: '#FEF3C7', borderRadius: 12 },
  driverInfoRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  driverAvatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#FDE68A', alignItems: 'center', justifyContent: 'center' },
  driverLabel: { fontSize: 10, fontWeight: '800', color: '#92400E', letterSpacing: 0.5 },
  driverName: { fontSize: 15, fontWeight: '700', color: '#111827', marginTop: 2 },
  callBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#10B981', borderRadius: 10, paddingVertical: 10, marginTop: 12 },
  callBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },

  otpBox: { borderWidth: 2, borderRadius: 14, padding: 16, marginTop: 12, alignItems: 'center' },
  otpStage: { fontSize: 10, fontWeight: '800', letterSpacing: 1, marginBottom: 4 },
  otpLabel: { fontSize: 13, fontWeight: '700' },
  otpCode: { fontSize: 40, fontWeight: '800', letterSpacing: 10, marginVertical: 8 },
  otpHint: { fontSize: 12, textAlign: 'center' },

  completedBox: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 12, padding: 12, backgroundColor: '#ECFDF5', borderRadius: 12 },
  completedText: { fontSize: 14, fontWeight: '700', color: '#10B981' },

  shareReceiptBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 10, paddingVertical: 12, backgroundColor: '#EFF6FF', borderRadius: 12, borderWidth: 1, borderColor: '#DBEAFE' },
  shareReceiptText: { fontSize: 14, fontWeight: '700', color: '#3B82F6' },
  loadMoreBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 14, marginTop: 4, backgroundColor: '#FFFFFF', borderRadius: 14, borderWidth: 1, borderColor: '#F3F4F6' },
  loadMoreText: { fontSize: 13, color: '#374151', fontWeight: '700' },
});