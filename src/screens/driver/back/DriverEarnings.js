import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, TouchableOpacity, Linking, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../../../firebase';
import { useAuth } from '../../contexts/AuthContext';

export default function DriverEarnings() {
  const { user, driverDoc } = useAuth();
  const [completedBookings, setCompletedBookings] = useState([]);
  const [pendingCodCommission, setPendingCodCommission] = useState(0);
  const [loading, setLoading] = useState(true);

  const todayPaise = driverDoc?.earnings?.todayInPaise || 0;
  const totalPaise = driverDoc?.earnings?.totalInPaise || 0;

  useEffect(() => {
    if (!user?.uid) { setLoading(false); return; }
    const q = query(
      collection(db, 'bookings'),
      where('driverId', '==', user.uid),
      where('status', '==', 'completed')
    );
    const unsub = onSnapshot(q, (snap) => {
      const data = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      data.sort((a, b) => (b.completedAt?.toMillis?.() || 0) - (a.completedAt?.toMillis?.() || 0));
      setCompletedBookings(data);

      // Calculate pending COD commission
      const pending = data
        .filter((b) => b.paymentMethod === 'cod' && b.commission?.status === 'pending_from_driver')
        .reduce((sum, b) => sum + (b.commission?.amountInPaise || 0), 0);
      setPendingCodCommission(pending);
      setLoading(false);
    });
    return () => unsub();
  }, [user?.uid]);

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
        <Text style={s.title}>💰 Earnings</Text>

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

        {/* COD Commission Owed */}
        {pendingCodCommission > 0 && (
          <View style={s.codCard}>
            <Text style={s.codTitle}>⚠️ COD Commission Owed</Text>
            <Text style={s.codAmount}>₹{(pendingCodCommission / 100).toFixed(0)}</Text>
            <Text style={s.codDesc}>
              You collected this in cash from customers. Please transfer this to LoadGo UPI:
            </Text>
            <View style={s.upiBox}>
              <Text style={s.upiLabel}>LoadGo UPI ID</Text>
              <Text style={s.upiId}>loadgo@upi</Text>
            </View>
            {/* PAY NOW via UPI */}
            <TouchableOpacity
              style={s.payNowBtn}
              onPress={() => {
                const amount = (pendingCodCommission / 100).toFixed(2);
                const upiUrl = `upi://pay?pa=loadgo@upi&pn=LoadGo&am=${amount}&cu=INR&tn=LoadGo%20Commission`;
                Linking.openURL(upiUrl).catch(() => {
                  Alert.alert('UPI Not Found', 'Please pay manually to: loadgo@upi\nAmount: ₹' + amount);
                });
              }}
            >
              <Text style={s.payNowText}>💳 Pay ₹{(pendingCodCommission / 100).toFixed(0)} via UPI Now</Text>
            </TouchableOpacity>
            <Text style={s.codNote}>Pay by every Sunday or it will be deducted from future bookings</Text>
          </View>
        )}

        {/* How earnings work */}
        <View style={s.infoCard}>
          <Text style={s.infoTitle}>How Earnings Work</Text>
          <InfoRow icon="💳" label="UPI Booking" value="80% of fare (auto)" />
          <InfoRow icon="💵" label="COD Booking" value="Collect 100% cash, pay 20% to LoadGo" />
          <InfoRow icon="📅" label="Commission due" value="Every Sunday" />
        </View>

        {/* Booking history */}
        {completedBookings.length > 0 && (
          <View style={s.historySection}>
            <Text style={s.historyTitle}>Recent Deliveries ({completedBookings.length})</Text>
            {completedBookings.slice(0, 10).map((b) => (
              <View key={b.id} style={s.historyCard}>
                <View style={s.historyRow}>
                  <Text style={s.historyVehicle}>{b.vehicleLabel || b.vehicleType}</Text>
                  <Text style={s.historyEarning}>
                    +₹{Math.round(((b.fare?.totalInPaise || 0) * 0.8) / 100)}
                  </Text>
                </View>
                <Text style={s.historyAddr} numberOfLines={1}>📍 {b.pickup?.address}</Text>
                <View style={[s.historyPayTag, b.paymentMethod === 'cod' ? s.historyTagCod : s.historyTagUpi]}>
                  <Text style={s.historyPayText}>
                    {b.paymentMethod === 'cod' ? '💵 COD' : '💳 UPI'}
                    {b.paymentMethod === 'cod' && b.commission?.status === 'pending_from_driver'
                      ? ' — Commission Pending' : ''}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function InfoRow({ icon, label, value }) {
  return (
    <View style={s.infoRow}>
      <Text style={s.infoIcon}>{icon}</Text>
      <Text style={s.infoLabel}>{label}</Text>
      <Text style={s.infoValue}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  scroll: { padding: 20, paddingBottom: 40 },
  title: { fontSize: 28, fontWeight: '700', color: '#1F2937', marginBottom: 20 },
  todayCard: {
    backgroundColor: '#10B981', borderRadius: 16, padding: 24,
    alignItems: 'center', marginBottom: 16,
  },
  todayLabel: { fontSize: 14, color: '#D1FAE5', fontWeight: '600' },
  todayAmount: { fontSize: 48, fontWeight: '800', color: '#fff', marginTop: 8 },
  totalCard: {
    backgroundColor: '#fff', borderRadius: 12, padding: 20, alignItems: 'center',
    marginBottom: 16, borderWidth: 1, borderColor: '#E5E7EB',
  },
  totalLabel: { fontSize: 14, color: '#6B7280', fontWeight: '600' },
  totalAmount: { fontSize: 32, fontWeight: '700', color: '#1F2937', marginTop: 8 },
  // COD Card
  codCard: {
    backgroundColor: '#FEF3C7', borderWidth: 2, borderColor: '#F59E0B',
    borderRadius: 12, padding: 16, marginBottom: 16,
  },
  codTitle: { fontSize: 16, fontWeight: '700', color: '#92400E' },
  codAmount: { fontSize: 32, fontWeight: '800', color: '#D97706', marginVertical: 8 },
  codDesc: { fontSize: 13, color: '#92400E', lineHeight: 20 },
  upiBox: {
    backgroundColor: '#fff', borderRadius: 8, padding: 12, marginTop: 12, alignItems: 'center',
  },
  upiLabel: { fontSize: 11, fontWeight: '600', color: '#6B7280' },
  upiId: { fontSize: 18, fontWeight: '800', color: '#10B981', marginTop: 4 },
  codNote: { fontSize: 11, color: '#B45309', marginTop: 10, fontStyle: 'italic' },
  payNowBtn: { backgroundColor: '#10B981', borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 12 },
  payNowText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  // Info card
  infoCard: {
    backgroundColor: '#fff', borderRadius: 12, padding: 16,
    borderWidth: 1, borderColor: '#E5E7EB', marginBottom: 16,
  },
  infoTitle: { fontSize: 16, fontWeight: '700', color: '#1F2937', marginBottom: 12 },
  infoRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderTopWidth: 1, borderTopColor: '#F3F4F6' },
  infoIcon: { fontSize: 18, width: 28 },
  infoLabel: { fontSize: 13, color: '#6B7280', flex: 1 },
  infoValue: { fontSize: 13, fontWeight: '600', color: '#1F2937', textAlign: 'right' },
  // History
  historySection: { marginTop: 8 },
  historyTitle: { fontSize: 16, fontWeight: '700', color: '#1F2937', marginBottom: 12 },
  historyCard: {
    backgroundColor: '#fff', borderRadius: 10, padding: 14, marginBottom: 10,
    borderWidth: 1, borderColor: '#E5E7EB',
  },
  historyRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  historyVehicle: { fontSize: 14, fontWeight: '600', color: '#1F2937' },
  historyEarning: { fontSize: 16, fontWeight: '700', color: '#10B981' },
  historyAddr: { fontSize: 12, color: '#6B7280', marginTop: 4 },
  historyPayTag: { marginTop: 8, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, alignSelf: 'flex-start' },
  historyTagUpi: { backgroundColor: '#EFF6FF' },
  historyTagCod: { backgroundColor: '#FEF3C7' },
  historyPayText: { fontSize: 11, fontWeight: '600', color: '#1F2937' },
});