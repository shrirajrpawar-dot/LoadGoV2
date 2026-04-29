import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, TouchableOpacity, Linking, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { collection, query, where, onSnapshot, limit } from 'firebase/firestore';
import { db } from '../../../firebase';
import { useAuth } from '../../contexts/AuthContext';

export default function DriverEarnings() {
  const { user, profile, driverDoc } = useAuth();
  const [completedBookings, setCompletedBookings] = useState([]);
  const [pendingCodCommission, setPendingCodCommission] = useState(0);
  const [sarthiOwesDriver, setSarthiOwesDriver] = useState(0); // unsettled razorpay payouts
  const [loading, setLoading] = useState(true);
  const [pageSize, setPageSize] = useState(30);
  const [hasMore, setHasMore] = useState(false);

  const todayPaise = driverDoc?.earnings?.todayInPaise || 0;
  const totalPaise = driverDoc?.earnings?.totalInPaise || 0;

  useEffect(() => {
    if (!user?.uid) { setLoading(false); return; }

    // Paged completed bookings — only what we need to render
    const qPaged = query(
      collection(db, 'bookings'),
      where('driverId', '==', user.uid),
      where('status', '==', 'completed'),
      limit(pageSize + 1) // one extra so we know if there's more
    );
    const unsubPaged = onSnapshot(qPaged, (snap) => {
      const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      all.sort((a, b) => (b.completedAt?.toMillis?.() || 0) - (a.completedAt?.toMillis?.() || 0));
      setHasMore(all.length > pageSize);
      setCompletedBookings(all.slice(0, pageSize));
      setLoading(false);
    });

    // Pending COD commission — narrow query so it stays cheap even with thousands of trips
    const qPending = query(
      collection(db, 'bookings'),
      where('driverId', '==', user.uid),
      where('commission.status', '==', 'pending_from_driver')
    );
    const unsubPending = onSnapshot(qPending, (snap) => {
      const total = snap.docs.reduce((sum, d) => sum + (d.data().commission?.amountInPaise || 0), 0);
      setPendingCodCommission(total);
    });

    // Unsettled Razorpay payouts — Sarthi owes driver these
    // Booking is razorpay + completed + payoutStatus !== 'settled'
    const qPayouts = query(
      collection(db, 'bookings'),
      where('driverId', '==', user.uid),
      where('paymentMethod', '==', 'razorpay'),
      where('status', '==', 'completed')
    );
    const unsubPayouts = onSnapshot(qPayouts, (snap) => {
      const total = snap.docs.reduce((sum, d) => {
        const data = d.data();
        if (data.payoutStatus === 'settled') return sum; // already paid out
        const fare = data.fare?.totalInPaise || 0;
        const commission = data.commission?.amountInPaise || 0;
        return sum + (fare - commission); // driver's earning
      }, 0);
      setSarthiOwesDriver(total);
    });

    return () => { unsubPaged(); unsubPending(); unsubPayouts(); };
  }, [user?.uid, pageSize]);

  if (loading) {
    return (
      <SafeAreaView style={s.container}>
        <View style={s.center}><ActivityIndicator size="large" color="#10B981" /></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.container}>
      <ScrollView contentContainerStyle={s.scroll}>
        <View style={s.header}>
          <Text style={s.title}>Earnings</Text>
          <Text style={s.subtitle}>Your delivery income</Text>
        </View>

        {/* Today */}
        <View style={s.todayCard}>
          <Text style={s.todayLabel}>Today's Earnings</Text>
          <Text style={s.todayAmount}>₹{(todayPaise / 100).toFixed(0)}</Text>
        </View>

        {/* Total */}
        <View style={s.totalCard}>
          <Text style={s.totalLabel}>Total Earnings</Text>
          <Text style={s.totalAmount}>₹{(totalPaise / 100).toFixed(0)}</Text>
        </View>

        {/* Net Balance: Sarthi owes you - You owe Sarthi */}
        {(sarthiOwesDriver > 0 || pendingCodCommission > 0) && (() => {
          const net = sarthiOwesDriver - pendingCodCommission;
          const positive = net >= 0;
          return (
            <View style={[s.balanceCard, positive ? s.balancePositive : s.balanceNegative]}>
              <Text style={s.balanceLabel}>
                {positive ? 'Sarthi owes you' : 'You owe Sarthi'}
              </Text>
              <Text style={[s.balanceAmount, positive ? s.balancePositiveTxt : s.balanceNegativeTxt]}>
                ₹{Math.abs(Math.round(net / 100))}
              </Text>
              <View style={s.balanceBreakdown}>
                {sarthiOwesDriver > 0 && (
                  <Text style={s.balanceLine}>
                    + ₹{Math.round(sarthiOwesDriver / 100)} unsettled UPI/card payouts
                  </Text>
                )}
                {pendingCodCommission > 0 && (
                  <Text style={s.balanceLine}>
                    − ₹{Math.round(pendingCodCommission / 100)} commission you owe (cash collected)
                  </Text>
                )}
              </View>
            </View>
          );
        })()}

        {/* COD Commission Owed */}
        {pendingCodCommission > 0 && (
          <View style={s.codCard}>
            <View style={s.codHeader}>
              <View style={s.codIconCircle}>
                <Ionicons name="alert" size={18} color="#92400E" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.codTitle}>COD Commission Owed</Text>
                <Text style={s.codAmount}>₹{(pendingCodCommission / 100).toFixed(0)}</Text>
              </View>
            </View>
            <Text style={s.codDesc}>
              You collected this in cash from customers. Please transfer this to Sarthi UPI:
            </Text>
            <View style={s.upiBox}>
              <Text style={s.upiLabel}>Sarthi UPI ID</Text>
              <Text style={s.upiId}>sarthi@upi</Text>
            </View>
            <TouchableOpacity
              style={s.payNowBtn}
              onPress={() => {
                const amount = (pendingCodCommission / 100).toFixed(2);
                const upiUrl = `upi://pay?pa=sarthi@upi&pn=Sarthi&am=${amount}&cu=INR&tn=Sarthi%20Commission`;
                Linking.openURL(upiUrl).catch(() => {
                  Alert.alert('UPI Not Found', 'Please pay manually to: sarthi@upi\nAmount: ₹' + amount);
                });
              }}
            >
              <Ionicons name="card" size={18} color="#FFF" />
              <Text style={s.payNowText}>Pay ₹{(pendingCodCommission / 100).toFixed(0)} via UPI Now</Text>
            </TouchableOpacity>
            <Text style={s.codNote}>Pay by every Sunday or it will be deducted from future bookings</Text>
          </View>
        )}

        {/* How earnings work */}
        <View style={s.infoCard}>
          <Text style={s.infoTitle}>How Earnings Work</Text>
          <InfoRow icon="card-outline" label="UPI Booking" value="80% of fare (auto)" />
          <InfoRow icon="cash-outline" label="COD Booking" value="Collect 100% cash, pay commission" />
          <InfoRow icon="calendar-outline" label="Commission due" value="Every Sunday" />
        </View>

        {/* Booking history */}
        {completedBookings.length > 0 && (
          <View style={s.historySection}>
            <Text style={s.historyTitle}>Lifetime Bookings</Text>
            <Text style={s.historySubtitle}>
              {hasMore ? `Showing ${completedBookings.length}` : `${completedBookings.length} completed deliveries`}
            </Text>

            {completedBookings.map((b) => {
              const totalFare = (b.fare?.totalInPaise || 0) / 100;
              const commissionPct = b.commission?.pct || 20;
              const commissionAmt = (b.commission?.amountInPaise || 0) / 100;
              const earning = totalFare - commissionAmt;
              const isCod = b.paymentMethod === 'cod';
              const isPending = isCod && b.commission?.status === 'pending_from_driver';
              const driverName = driverDoc?.kyc?.fullName || profile?.name || 'Driver';

              return (
                <View key={b.id} style={s.historyCard}>
                  <View style={s.historyRow}>
                    <Text style={s.historyVehicle}>{b.vehicleLabel || b.vehicleType}</Text>
                    <Text style={s.historyEarning}>+₹{earning.toFixed(0)}</Text>
                  </View>
                  <View style={s.historyAddrRow}>
                    <View style={s.greenDot} />
                    <Text style={s.historyAddr} numberOfLines={1}>{b.pickup?.address}</Text>
                  </View>

                  {/* Fare Breakdown */}
                  <View style={s.fareBreakdown}>
                    <View style={s.fareRow}>
                      <Text style={s.fareLabel}>Total Fare</Text>
                      <Text style={s.fareValue}>₹{totalFare.toFixed(0)}</Text>
                    </View>
                    <View style={s.fareRow}>
                      <Text style={s.fareLabelRed}>Commission ({commissionPct}%)</Text>
                      <Text style={s.fareValueRed}>-₹{commissionAmt.toFixed(0)}</Text>
                    </View>
                    <View style={[s.fareRow, s.fareRowTotal]}>
                      <Text style={s.fareLabelTotal}>Your Earning</Text>
                      <Text style={s.fareValueTotal}>₹{earning.toFixed(0)}</Text>
                    </View>
                  </View>

                  {/* Pay tag + Receipt button row */}
                  <View style={s.cardFooterRow}>
                    <View style={[s.historyPayTag, isCod ? s.historyTagCod : s.historyTagUpi]}>
                      <Text style={s.historyPayText}>
                        {isCod ? '💵 COD' : '💳 UPI'}
                        {isPending ? ' — Pending' : ''}
                      </Text>
                    </View>
                    <TouchableOpacity
                      style={s.receiptBtn}
                      onPress={() => shareDriverReceipt(b, driverName)}
                    >
                      <Ionicons name="document-text-outline" size={14} color="#3B82F6" />
                      <Text style={s.receiptBtnText}>Receipt</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}

            {hasMore && (
              <TouchableOpacity
                style={s.loadMoreBtn}
                onPress={() => setPageSize(pageSize + 30)}
              >
                <Ionicons name="chevron-down" size={16} color="#374151" />
                <Text style={s.loadMoreText}>Load More</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// Build HTML invoice for driver earnings (per booking)
function buildDriverReceiptHTML(b, driverName) {
  const totalFare = (b.fare?.totalInPaise || 0) / 100;
  const baseFare = Math.round((b.fare?.baseFare || 0) / 100);
  const distanceFare = Math.round((b.fare?.distanceFare || 0) / 100);
  const commissionPct = b.commission?.pct || 20;
  const commissionAmt = (b.commission?.amountInPaise || 0) / 100;
  const earning = totalFare - commissionAmt;
  const isCod = b.paymentMethod === 'cod';
  const completedDate = b.completedAt?.toDate?.()?.toLocaleString() ||
                        b.createdAt?.toDate?.()?.toLocaleString() ||
                        new Date().toLocaleString();
  const bookingShortId = b.id.substring(0, 12).toUpperCase();
  const escape = (str) => String(str || '').replace(/[<>&"]/g, c => ({ '<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;' }[c]));

  return `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8" />
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, "Helvetica Neue", Arial, sans-serif; color: #111827; padding: 36px 32px; background: #FFFFFF; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 24px; border-bottom: 1px solid #E5E7EB; }
  .brand-logo { width: 44px; height: 44px; background: #111827; color: #FFFFFF; border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 22px; font-weight: 900; letter-spacing: -1px; margin-bottom: 12px; }
  .brand-name { font-size: 20px; font-weight: 800; color: #111827; }
  .brand-tag { font-size: 12px; color: #6B7280; margin-top: 2px; }
  .invoice-meta { text-align: right; }
  .invoice-label { font-size: 10px; color: #9CA3AF; font-weight: 700; letter-spacing: 0.8px; }
  .invoice-no { font-size: 14px; color: #111827; font-weight: 700; margin-top: 4px; font-family: ui-monospace, monospace; }
  .invoice-date { font-size: 11px; color: #6B7280; margin-top: 6px; }
  .status-pill { display: inline-block; background: #ECFDF5; color: #065F46; padding: 4px 12px; border-radius: 999px; font-size: 11px; font-weight: 700; margin-top: 10px; }

  .earnings-banner { background: #ECFDF5; border: 1px solid #A7F3D0; border-radius: 16px; padding: 20px; margin-top: 24px; text-align: center; }
  .earnings-label { font-size: 11px; color: #065F46; font-weight: 800; letter-spacing: 0.8px; }
  .earnings-amount { font-size: 38px; color: #10B981; font-weight: 900; margin-top: 6px; letter-spacing: -1px; }

  .section { margin-top: 24px; }
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

  .fare-table { width: 100%; border-collapse: collapse; }
  .fare-table td { padding: 9px 0; font-size: 13px; }
  .fare-table td:last-child { text-align: right; font-weight: 600; color: #111827; }
  .fare-table .desc { color: #6B7280; }
  .fare-table .commission-row td { color: #EF4444; }
  .fare-table .commission-row td:last-child { color: #EF4444; font-weight: 700; }
  .fare-table tr.divider td { padding: 0; }
  .fare-table tr.divider hr { border: none; height: 1px; background: #E5E7EB; }
  .fare-table tr.total td { padding-top: 14px; font-size: 16px; font-weight: 800; }
  .fare-table tr.total td:last-child { color: #10B981; }

  .payment-row { display: flex; justify-content: space-between; align-items: center; background: ${isCod ? '#FEF3C7' : '#EFF6FF'}; border: 1px solid ${isCod ? '#FDE68A' : '#BFDBFE'}; border-radius: 12px; padding: 14px 16px; margin-top: 16px; }
  .payment-label { font-size: 11px; color: #6B7280; font-weight: 700; }
  .payment-value { font-size: 13px; color: #111827; font-weight: 700; }

  .footer { margin-top: 36px; padding-top: 20px; border-top: 1px solid #E5E7EB; text-align: center; }
  .thanks { font-size: 13px; color: #111827; font-weight: 700; }
  .footnote { font-size: 11px; color: #9CA3AF; margin-top: 6px; }
</style>
</head>
<body>
  <div class="header">
    <div>
      <div class="brand-logo">L</div>
      <div class="brand-name">Sarthi</div>
      <div class="brand-tag">Driver Earnings Receipt</div>
    </div>
    <div class="invoice-meta">
      <div class="invoice-label">RECEIPT</div>
      <div class="invoice-no">#${escape(bookingShortId)}</div>
      <div class="invoice-date">${escape(completedDate)}</div>
      <div class="status-pill">Completed</div>
    </div>
  </div>

  <div class="earnings-banner">
    <div class="earnings-label">YOUR EARNING</div>
    <div class="earnings-amount">₹${earning.toFixed(0)}</div>
  </div>

  <div class="section">
    <div class="section-label">TRIP DETAILS</div>
    <div class="row-grid">
      <div class="col">
        <div class="row-label">Driver</div>
        <div class="row-value">${escape(driverName || '—')}</div>
      </div>
      <div class="col">
        <div class="row-label">Customer</div>
        <div class="row-value">${escape(b.customerName || '—')}</div>
      </div>
      <div class="col">
        <div class="row-label">Vehicle</div>
        <div class="row-value">${escape(b.vehicleLabel || b.vehicleType || '—')}</div>
      </div>
      <div class="col">
        <div class="row-label">Distance</div>
        <div class="row-value">${escape(b.distanceKm || '—')} km</div>
      </div>
    </div>
  </div>

  <div class="section">
    <div class="section-label">ROUTE</div>
    <div class="route-card">
      <div class="stop">
        <div class="stop-marker-green"></div>
        <div class="stop-text">${escape(b.pickup?.address || '—')}</div>
      </div>
      <div class="stop-divider"></div>
      <div class="stop">
        <div class="stop-marker-red"></div>
        <div class="stop-text">${escape(b.drop?.address || '—')}</div>
      </div>
    </div>
  </div>

  <div class="section">
    <div class="section-label">EARNINGS BREAKDOWN</div>
    <table class="fare-table">
      <tr>
        <td class="desc">Base Fare</td>
        <td>₹${baseFare}</td>
      </tr>
      <tr>
        <td class="desc">Distance${b.distanceKm ? ` (${b.distanceKm} km)` : ''}</td>
        <td>₹${distanceFare}</td>
      </tr>
      <tr>
        <td class="desc"><strong>Total Fare</strong></td>
        <td><strong>₹${totalFare.toFixed(0)}</strong></td>
      </tr>
      <tr class="commission-row">
        <td>Commission (${commissionPct}%)</td>
        <td>− ₹${commissionAmt.toFixed(0)}</td>
      </tr>
      <tr class="divider"><td colspan="2"><hr/></td></tr>
      <tr class="total">
        <td>Your Earning</td>
        <td>₹${earning.toFixed(0)}</td>
      </tr>
    </table>

    <div class="payment-row">
      <div class="payment-label">PAYMENT METHOD</div>
      <div class="payment-value">${isCod ? '💵 Cash on Delivery' : '💳 UPI (Online)'}</div>
    </div>
  </div>

  <div class="footer">
    <div class="thanks">Thank you for delivering with Sarthi</div>
    <div class="footnote">Generated on ${escape(new Date().toLocaleString())}</div>
  </div>
</body>
</html>
  `;
}

async function shareDriverReceipt(booking, driverName) {
  try {
    const html = buildDriverReceiptHTML(booking, driverName);
    const { uri } = await Print.printToFileAsync({ html, base64: false });
    const isAvailable = await Sharing.isAvailableAsync();
    if (isAvailable) {
      await Sharing.shareAsync(uri, {
        mimeType: 'application/pdf',
        dialogTitle: `Receipt - ${booking.id.substring(0, 8)}`,
        UTI: 'com.adobe.pdf',
      });
    } else {
      Alert.alert('PDF Saved', `Receipt saved to: ${uri}`);
    }
  } catch (error) {
    Alert.alert('Error', 'Could not generate receipt: ' + error.message);
  }
}

function InfoRow({ icon, label, value }) {
  return (
    <View style={s.infoRow}>
      <View style={s.infoIconCircle}>
        <Ionicons name={icon} size={16} color="#6B7280" />
      </View>
      <Text style={s.infoLabel}>{label}</Text>
      <Text style={s.infoValue}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F3F4F6' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  scroll: { padding: 16, paddingBottom: 40 },

  header: { paddingHorizontal: 4, paddingTop: 8, paddingBottom: 18 },
  title: { fontSize: 26, fontWeight: '800', color: '#111827' },
  subtitle: { fontSize: 13, color: '#6B7280', fontWeight: '600', marginTop: 2 },

  // Today's earnings — green hero card
  todayCard: { backgroundColor: '#10B981', borderRadius: 20, padding: 24, alignItems: 'center', marginBottom: 12, shadowColor: '#10B981', shadowOpacity: 0.2, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 6 },
  todayLabel: { fontSize: 13, color: '#D1FAE5', fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' },
  todayAmount: { fontSize: 48, fontWeight: '900', color: '#FFFFFF', marginTop: 6 },

  // Total card — soft white
  totalCard: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 18, alignItems: 'center', marginBottom: 16, borderWidth: 1, borderColor: '#F3F4F6', shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 8, elevation: 2 },
  totalLabel: { fontSize: 13, color: '#6B7280', fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' },
  totalAmount: { fontSize: 30, fontWeight: '800', color: '#111827', marginTop: 6 },
  balanceCard: { borderRadius: 16, padding: 18, marginBottom: 16, borderWidth: 1.5 },
  balancePositive: { backgroundColor: '#ECFDF5', borderColor: '#A7F3D0' },
  balanceNegative: { backgroundColor: '#FEF3C7', borderColor: '#FDE68A' },
  balanceLabel: { fontSize: 12, fontWeight: '800', color: '#374151', letterSpacing: 0.4, textTransform: 'uppercase' },
  balanceAmount: { fontSize: 30, fontWeight: '900', marginTop: 6, letterSpacing: -1 },
  balancePositiveTxt: { color: '#065F46' },
  balanceNegativeTxt: { color: '#92400E' },
  balanceBreakdown: { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: 'rgba(0,0,0,0.06)' },
  balanceLine: { fontSize: 12, color: '#374151', fontWeight: '600', marginVertical: 2 },

  // COD Owed card — amber alert
  codCard: { backgroundColor: '#FEF3C7', borderWidth: 1, borderColor: '#FCD34D', borderRadius: 16, padding: 16, marginBottom: 16 },
  codHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  codIconCircle: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#FDE68A', alignItems: 'center', justifyContent: 'center' },
  codTitle: { fontSize: 14, fontWeight: '800', color: '#92400E', letterSpacing: 0.3 },
  codAmount: { fontSize: 26, fontWeight: '900', color: '#B45309', marginTop: 2 },
  codDesc: { fontSize: 13, color: '#92400E', lineHeight: 19 },
  upiBox: { backgroundColor: '#FFFFFF', borderRadius: 12, padding: 12, marginTop: 12, alignItems: 'center', borderWidth: 1, borderColor: '#FDE68A' },
  upiLabel: { fontSize: 11, fontWeight: '700', color: '#6B7280', letterSpacing: 0.5 },
  upiId: { fontSize: 18, fontWeight: '800', color: '#10B981', marginTop: 4 },
  codNote: { fontSize: 11, color: '#B45309', marginTop: 10, textAlign: 'center' },
  payNowBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#111827', borderRadius: 14, paddingVertical: 14, marginTop: 14 },
  payNowText: { color: '#FFFFFF', fontWeight: '700', fontSize: 15 },

  // Info card
  infoCard: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#F3F4F6', marginBottom: 16 },
  infoTitle: { fontSize: 16, fontWeight: '800', color: '#111827', marginBottom: 12 },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#F3F4F6' },
  infoIconCircle: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center' },
  infoLabel: { fontSize: 13, color: '#6B7280', flex: 1, fontWeight: '600' },
  infoValue: { fontSize: 13, fontWeight: '700', color: '#111827', textAlign: 'right' },

  // History
  historySection: { marginTop: 4 },
  historyTitle: { fontSize: 16, fontWeight: '800', color: '#111827' },
  historySubtitle: { fontSize: 12, color: '#6B7280', fontWeight: '600', marginTop: 2, marginBottom: 12 },
  historyCard: { backgroundColor: '#FFFFFF', borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#F3F4F6' },
  historyRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  historyVehicle: { fontSize: 14, fontWeight: '700', color: '#111827' },
  historyEarning: { fontSize: 18, fontWeight: '800', color: '#10B981' },
  historyAddrRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  greenDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#10B981' },
  historyAddr: { flex: 1, fontSize: 12, color: '#6B7280', fontWeight: '500' },

  // Fare breakdown
  fareBreakdown: { marginTop: 12, padding: 10, backgroundColor: '#F9FAFB', borderRadius: 10, borderWidth: 1, borderColor: '#F3F4F6' },
  fareRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  fareRowTotal: { borderTopWidth: 1, borderTopColor: '#E5E7EB', marginTop: 4, paddingTop: 6 },
  fareLabel: { fontSize: 12, color: '#6B7280', fontWeight: '500' },
  fareValue: { fontSize: 12, fontWeight: '700', color: '#374151' },
  fareLabelRed: { fontSize: 12, color: '#EF4444', fontWeight: '500' },
  fareValueRed: { fontSize: 12, fontWeight: '700', color: '#EF4444' },
  fareLabelTotal: { fontSize: 13, fontWeight: '700', color: '#111827' },
  fareValueTotal: { fontSize: 14, fontWeight: '800', color: '#10B981' },

  cardFooterRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, gap: 10 },
  historyPayTag: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  historyTagUpi: { backgroundColor: '#EFF6FF' },
  historyTagCod: { backgroundColor: '#FEF3C7' },
  historyPayText: { fontSize: 11, fontWeight: '700', color: '#1F2937' },
  receiptBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: '#EFF6FF', borderWidth: 1, borderColor: '#DBEAFE' },
  receiptBtnText: { fontSize: 12, fontWeight: '700', color: '#3B82F6' },
  loadMoreBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, marginTop: 4, backgroundColor: '#FFFFFF', borderRadius: 12, borderWidth: 1, borderColor: '#F3F4F6' },
  loadMoreText: { fontSize: 13, color: '#374151', fontWeight: '700' },
});