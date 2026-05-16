import React, { useEffect, useState, useRef } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Alert, ActivityIndicator, Switch, ScrollView, TextInput, Linking, Animated, Platform, Dimensions,
  KeyboardAvoidingView
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import {
  collection, query, where, onSnapshot, limit,
  doc, updateDoc, getDoc, serverTimestamp, arrayUnion, addDoc,
  runTransaction, increment,
} from 'firebase/firestore';
import { db } from '../../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { useAppSettings } from '../../hooks/useAppSettings';

const { width, height } = Dimensions.get('window');

const VLABELS = {
  bike: '🏍️ Bike', 
  '3wheeler': '🛺 3 Wheeler Rickshaw',
  '3wheeler_transport': '🛺 3 Wheeler Transport',
  chota_hatti: '🚛 Chota Hatti', 
  tempo: '🚚 Tempo',
  sedan: '🚗 Sedan',
  hatchback: '🚙 Hatchback',
  '7_seater': '🚐 7 Seater'
};

export default function DriverHome() {
  const { user, profile, driverDoc } = useAuth();
  const { settings } = useAppSettings();
  const mapRef = useRef(null);
  
  const [isOnline, setIsOnline] = useState(false);
  const [allSearching, setAllSearching] = useState([]);
  const [myBookings, setMyBookings] = useState([]);
  const [otpInput, setOtpInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [driverLocation, setDriverLocation] = useState(null); // {lat, lng}
  const [pendingCommissionPaise, setPendingCommissionPaise] = useState(0);

  // KYC status check
  const kycStatus = driverDoc?.kyc?.status || 'not_started';
  const isKycApproved = kycStatus === 'approved' || kycStatus === 'verified';
  const isBlocked = !!driverDoc?.blocked;
  const maxOwedRupees = Number(settings.maxOwedCommission) || 500;
  const pendingCommissionRupees = Math.round(pendingCommissionPaise / 100);
  const isCommissionBlocked = pendingCommissionRupees > maxOwedRupees;

  // Active states the driver still cares about (current trip)
  const ACTIVE_STATES = ['accepted', 'arrived', 'picked_up', 'reached_dropoff', 'awaiting_payment'];

  const currentBooking = myBookings.find(b => ACTIVE_STATES.includes(b.status)) || null;

  // Haversine — straight-line distance in km
  const haversineKm = (lat1, lng1, lat2, lng2) => {
    if (lat1 == null || lng1 == null || lat2 == null || lng2 == null) return null;
    const R = 6371; // Earth radius in km
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  };

  // Lookup vehicle config from settings (across both lists)
  const findVehicleConfig = (vehicleId) => {
    return (settings.parcelVehicles || []).find(v => v.id === vehicleId)
        || (settings.rideVehicles || []).find(v => v.id === vehicleId)
        || null;
  };

  // Decorate each available booking with distanceKm + driver pickup premium
  const availableBookings = allSearching
    .filter(b => !(b.rejectedByDrivers || []).includes(user?.uid))
    .map(b => {
      const dKm = (driverLocation && b.pickup?.lat)
        ? haversineKm(driverLocation.lat, driverLocation.lng, b.pickup.lat, b.pickup.lng)
        : null;
      const vCfg = findVehicleConfig(b.vehicleType);
      const freeKm = Number(vCfg?.pickupFreeKm) || 2;
      const rate = Number(vCfg?.pickupKmRate) || 0;
      const premium = (dKm != null) ? Math.round(Math.max(0, Math.min(dKm, Number(settings.searchRadiusKm) || 5) - freeKm) * rate) : null;
      return { ...b, _distanceKm: dKm, _pickupPremium: premium };
    })
    .sort((a, b) => {
      // Nearest first; bookings without distance go to the end
      if (a._distanceKm == null && b._distanceKm == null) return 0;
      if (a._distanceKm == null) return 1;
      if (b._distanceKm == null) return -1;
      return a._distanceKm - b._distanceKm;
    });

  useEffect(() => {
    if (!user?.uid) return;

    const unsubDriver = onSnapshot(doc(db, 'drivers', user.uid), snap => {
      if (snap.exists()) setIsOnline(snap.data().status === 'online');
    });

    // Only run searching listener when driver is online AND has a vehicle type set.
    // No vehicle type? skip — we'd download every searching booking otherwise.
    let unsubSearching = () => {};
    const myVehicleType = driverDoc?.vehicle?.type;
    if (isOnline && myVehicleType) {
      unsubSearching = onSnapshot(
        query(
          collection(db, 'bookings'),
          where('status', '==', 'searching'),
          where('vehicleType', '==', myVehicleType),
          limit(20),
        ),
        snap => {
          setAllSearching(snap.docs.map(d => ({ id: d.id, ...d.data() })));
          setLoading(false);
        }
      );
    } else {
      // Driver offline / no vehicle — clear list, don't subscribe
      setAllSearching([]);
      setLoading(false);
    }

    // Only watch the driver's own bookings that are still in flight.
    // Past completed/cancelled bookings don't need a live listener — they live on the Earnings page.
    const unsubMine = onSnapshot(
      query(
        collection(db, 'bookings'),
        where('driverId', '==', user.uid),
        where('status', 'in', [...ACTIVE_STATES, 'completed']),
        limit(5),
      ),
      snap => {
        setMyBookings(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      }
    );

    return () => { unsubDriver(); unsubSearching(); unsubMine(); };
  }, [user?.uid, isOnline, driverDoc?.vehicle?.type]);

  // Live driver location: update Firestore only when moved 100m+
  const lastWrittenLocation = useRef(null);
  useEffect(() => {
    if (!user?.uid || !isOnline) return;

    let cancelled = false;

    const updateLocationOnce = async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') return;
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (cancelled) return;
        const coord = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setDriverLocation(coord);

        // Only write to Firestore if moved 100m+ (saves writes at scale)
        const prev = lastWrittenLocation.current;
        const moved = prev ? haversineKm(prev.lat, prev.lng, coord.lat, coord.lng) * 1000 : 9999; // meters
        if (moved > 100 || !prev) {
          lastWrittenLocation.current = coord;
          await updateDoc(doc(db, 'drivers', user.uid), {
            location: { ...coord, updatedAt: serverTimestamp() },
          });
        }
      } catch (e) {
        // silently ignore — driver might've revoked permission
      }
    };

    updateLocationOnce(); // immediate
    const interval = setInterval(updateLocationOnce, 30000); // every 30s

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [user?.uid, isOnline]);

  useEffect(() => {
    const target = currentBooking || availableBookings[focusedIndex];
    if (target?.pickup?.lat && target?.drop?.lat && mapRef.current) {
      setTimeout(() => {
        mapRef.current?.fitToCoordinates([
          { latitude: target.pickup.lat, longitude: target.pickup.lng },
          { latitude: target.drop.lat, longitude: target.drop.lng }
        ], { edgePadding: { top: 100, right: 60, bottom: height * 0.45, left: 60 }, animated: true });
      }, 600);
    }
  }, [currentBooking?.status, focusedIndex, availableBookings.length]);

  // Pending commission listener + auto-enforcement + auto-unblock
  useEffect(() => {
    if (!user?.uid) return;
    const q = query(
      collection(db, 'bookings'),
      where('driverId', '==', user.uid),
      where('commission.status', '==', 'pending_from_driver')
    );
    const unsub = onSnapshot(q, async (snap) => {
      const total = snap.docs.reduce((sum, d) => sum + (d.data().commission?.amountInPaise || 0), 0);
      setPendingCommissionPaise(total);
      
      const duesRupees = Math.round(total / 100);
      const maxRupees = Number(settings.maxOwedCommission) || 500;
      
      // Auto-force offline if dues exceed limit while driver is online
      if (isOnline && duesRupees > maxRupees) {
        try {
          await updateDoc(doc(db, 'drivers', user.uid), { status: 'offline' });
          Alert.alert(
            '💰 Commission Dues Exceeded',
            `You owe ₹${duesRupees} (limit: ₹${maxRupees}). You've been automatically set offline. Pay your dues to go back online.`,
            [{ text: 'Pay Now', onPress: payCommission }]
          );
        } catch (e) {
          console.error('Could not force offline:', e.message);
        }
      }
      
      // Auto-unblock if dues now < limit and driver was previously blocked
      if (!isOnline && duesRupees < maxRupees && driverDoc?.commissionPaymentClaimedAt) {
        try {
          await updateDoc(doc(db, 'drivers', user.uid), { 
            commissionPaymentClaimedAt: null, // Clear the payment claim flag
          });
          Alert.alert(
            '✅ Commission Cleared!',
            `Your dues are now settled. You can go online again!`,
            [{ text: 'Go Online', onPress: () => setIsOnline(true) }]
          );
        } catch (e) {
          console.error('Could not auto-unblock:', e.message);
        }
      }
    });
    return () => unsub();
  }, [user?.uid, isOnline, settings.maxOwedCommission, driverDoc?.commissionPaymentClaimedAt]);

  // Pay commission via UPI to Sarthi
  const payCommission = async () => {
    const sarthiUpi = settings.upiId;
    if (!sarthiUpi) {
      Alert.alert('Error', 'Company UPI ID not configured. Contact admin.');
      return;
    }
    const amount = pendingCommissionRupees;
    const note = encodeURIComponent(`Sarthi Commission - ${user.uid.slice(0, 6)}`);
    const upiUrl = `upi://pay?pa=${sarthiUpi}&pn=Sarthi&am=${amount}&cu=INR&tn=${note}`;
    try {
      const supported = await Linking.canOpenURL(upiUrl);
      if (!supported) {
        Alert.alert('No UPI App', `Pay manually to ${sarthiUpi}, amount ₹${amount}`);
        return;
      }
      await Linking.openURL(upiUrl);
      
      // After UPI app returns, ask if payment was sent
      setTimeout(() => {
        Alert.alert(
          'Payment Confirmation',
          `Did you complete the payment of ₹${amount}?`,
          [
            { text: 'No, not yet', style: 'cancel' },
            {
              text: 'Yes, I paid!',
              onPress: () => {
                // Add a marker that driver claims payment sent
                updateDoc(doc(db, 'drivers', user.uid), {
                  commissionPaymentClaimedAt: new Date().toISOString(),
                  commissionPaymentAmount: amount,
                })
                  .then(() => {
                    Alert.alert(
                      '✅ Payment Logged',
                      `Your payment of ₹${amount} has been recorded. Admin will verify within 1-2 hours and you'll be unblocked automatically.`,
                      [{ text: 'OK', onPress: () => {} }]
                    );
                  })
                  .catch(e => Alert.alert('Error', e.message));
              },
            },
          ]
        );
      }, 1000);
    } catch (e) {
      Alert.alert('Error', e.message);
    }
  };

  const toggleOnline = async () => {
    if (!isKycApproved) {
      Alert.alert(
        "🔒 KYC Required",
        "Your account is not yet verified. Please complete your KYC and wait for admin approval to start receiving bookings.",
        [{ text: "View KYC Status", onPress: () => {} }]
      );
      return;
    }

    if (isBlocked) {
      Alert.alert(
        "🚫 Account Blocked",
        "Your account has been blocked by admin. Contact support for details."
      );
      return;
    }

    if (!isOnline && isCommissionBlocked) {
      Alert.alert(
        "💰 Commission Due",
        `You owe ₹${pendingCommissionRupees} in commission (limit ₹${maxOwedRupees}). Please clear your dues to go online.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Pay Now', onPress: payCommission },
        ]
      );
      return;
    }

    try {
      await updateDoc(doc(db, 'drivers', user.uid), { 
        status: isOnline ? 'offline' : 'online' 
      });
    } catch (e) { 
      Alert.alert("Error", "Could not change status"); 
    }
  };

  const updateBookingStatus = async (s) => {
    if (!currentBooking?.id) return;
    setActionLoading(true);
    try {
      await updateDoc(doc(db, 'bookings', currentBooking.id), { status: s });
    } catch (e) {
      Alert.alert("Error", "Could not update status");
    }
    setActionLoading(false);
  };

  const completeBooking = async (booking) => {
    await updateDoc(doc(db, 'bookings', booking.id), {
      status: 'completed',
      completedAt: serverTimestamp(),
    });

    const totalFare = booking.fare?.totalInPaise || 0;
    const commissionPct = booking.commission?.pct || 20;
    const earnPaise = Math.round(totalFare * (100 - commissionPct) / 100);

    // Atomic increment — no race condition even with simultaneous completions
    const driverRef = doc(db, 'drivers', user.uid);
    await updateDoc(driverRef, {
      'earnings.todayInPaise': increment(earnPaise),
      'earnings.totalInPaise': increment(earnPaise),
      'earnings.lastEarningDate': new Date().toISOString().slice(0, 10), // for midnight reset
    });

    Alert.alert("Job Done!", `You earned ₹${Math.round(earnPaise / 100)}`);
  };

  const verifyOtp = async (type) => {
    if (!currentBooking) return;
    const correct = type === 'pickup' ? currentBooking.pickupOtp : currentBooking.deliveryOtp;
    if (otpInput !== correct) return Alert.alert("Wrong OTP", "Please ask the customer for the correct code.");
    
    setActionLoading(true);
    try {
      if (type === 'pickup') {
        await updateDoc(doc(db, 'bookings', currentBooking.id), { status: 'picked_up' });
      } else {
        // Check if payment is pending before completing
        const isUpi = currentBooking.paymentMethod === 'upi_direct' || currentBooking.paymentMethod === 'upi';
        const isCod = currentBooking.paymentMethod === 'cod' || !currentBooking.paymentMethod;
        const isPaid = currentBooking.paymentStatus === 'driver_confirmed';

        if (isPaid) {
          // Already confirmed — complete immediately
          await completeBooking(currentBooking);
        } else if (isUpi) {
          // UPI not yet confirmed — park in awaiting_payment
          await updateDoc(doc(db, 'bookings', currentBooking.id), {
            status: 'awaiting_payment',
            deliveryOtpVerifiedAt: serverTimestamp(),
          });
          Alert.alert(
            "Delivery Verified!",
            "Now confirm you've received the UPI payment to complete this trip."
          );
        } else if (isCod) {
          // Cash — park in awaiting_payment, wait for cash collection confirmation
          await updateDoc(doc(db, 'bookings', currentBooking.id), {
            status: 'awaiting_payment',
            deliveryOtpVerifiedAt: serverTimestamp(),
          });
          Alert.alert(
            "Delivery Verified!",
            "Collect the cash payment from the customer and confirm below."
          );
        } else {
          // Razorpay or other — complete immediately
          await completeBooking(currentBooking);
        }
      }
      setOtpInput('');
    } catch (e) {
      console.error('verifyOtp error:', e);
      Alert.alert("Error", "Verification failed");
    }
    setActionLoading(false);
  };

  const handleCall = (phone) => {
    if (!phone) return Alert.alert("Error", "Customer phone number not found.");
    Linking.openURL(`tel:${phone}`);
  };

  const openInMaps = (lat, lng, label) => {
    if (!lat || !lng) {
      return Alert.alert("Error", "Location coordinates not available.");
    }
    // Google Maps directions URL — works on Android (opens app), iOS (opens in browser/app), web
    const labelEncoded = encodeURIComponent(label || '');
    const url = Platform.OS === 'ios'
      ? `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`
      : `google.navigation:q=${lat},${lng}`;
    Linking.openURL(url).catch(() => {
      // Fallback to web URL if native app not installed
      Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`);
    });
  };

  if (loading || !user) return <View style={s.center}><ActivityIndicator size="large" color="#000" /></View>;

  return (
    <View style={s.container}>
      <MapView 
        ref={mapRef} 
        provider={PROVIDER_GOOGLE} 
        style={s.map} 
        showsUserLocation={true}
        showsMyLocationButton={false}
        initialRegion={{ latitude: 19.076, longitude: 72.8777, latitudeDelta: 0.05, longitudeDelta: 0.05 }}
      >
         {currentBooking?.pickup && (
           <>
            <Marker coordinate={{latitude: currentBooking.pickup.lat, longitude: currentBooking.pickup.lng}} title="Pickup" />
            <Marker coordinate={{latitude: currentBooking.drop.lat, longitude: currentBooking.drop.lng}} pinColor="blue" title="Dropoff" />
           </>
         )}
         {/* Show focused available booking on map BEFORE accepting */}
         {!currentBooking && availableBookings[focusedIndex]?.pickup?.lat && (
           <>
            <Marker
              coordinate={{
                latitude: availableBookings[focusedIndex].pickup.lat,
                longitude: availableBookings[focusedIndex].pickup.lng,
              }}
              title="Pickup"
              pinColor="green"
            />
            <Marker
              coordinate={{
                latitude: availableBookings[focusedIndex].drop.lat,
                longitude: availableBookings[focusedIndex].drop.lng,
              }}
              title="Dropoff"
              pinColor="blue"
            />
           </>
         )}
      </MapView>

      {/* Locate-me button */}
      <TouchableOpacity 
        style={s.locateBtn}
        onPress={async () => {
          try {
            const { status } = await Location.requestForegroundPermissionsAsync();
            if (status !== 'granted') {
              Alert.alert('Permission denied', 'Location permission is required.');
              return;
            }
            const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
            mapRef.current?.animateToRegion({
              latitude: current.coords.latitude,
              longitude: current.coords.longitude,
              latitudeDelta: 0.01,
              longitudeDelta: 0.01,
            }, 600);
          } catch (e) {
            Alert.alert('Error', 'Could not get current location.');
          }
        }}
        activeOpacity={0.85}
      >
        <Ionicons name="locate" size={22} color="#111827" />
      </TouchableOpacity>

      <SafeAreaView style={s.header} pointerEvents="box-none">
        <View style={s.headerBox}>
          <TouchableOpacity 
            style={{ flex: 1 }}
            disabled={isKycApproved}
            onPress={() => {
              Alert.alert(
                'KYC Required',
                'Please complete your KYC verification first. Go to the Profile tab and tap "Update KYC".',
                [{ text: 'OK' }]
              );
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={s.title}>Driver Mode</Text>
                {!isKycApproved && <Ionicons name="lock-closed" size={16} color="#F59E0B" style={{ marginLeft: 6 }} />}
            </View>
            <Text style={{ fontSize: 12, color: isBlocked ? '#EF4444' : !isKycApproved ? '#F59E0B' : isCommissionBlocked ? '#F59E0B' : (isOnline ? 'green' : 'red'), fontWeight: '600' }}>
              {isBlocked ? '🚫 BLOCKED' : !isKycApproved ? `KYC ${kycStatus.toUpperCase()} — Tap for help` : isCommissionBlocked ? '💰 DUES PENDING' : (isOnline ? 'ONLINE' : 'OFFLINE')}
            </Text>
          </TouchableOpacity>
          <Switch 
            value={isOnline} 
            onValueChange={toggleOnline}
            disabled={isBlocked}
            trackColor={{ false: "#D1D5DB", true: isBlocked ? '#FECACA' : "#10B981" }}
          />
        </View>
      </SafeAreaView>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.bottom}>
        {currentBooking ? (
          <View style={s.panel}>
            <Text style={s.statusTxt}>{currentBooking.status?.replace('_', ' ').toUpperCase()}</Text>
            <View style={s.customerBox}>
               <Text style={s.name}>{currentBooking.customerName || 'Customer'}</Text>
               <TouchableOpacity onPress={() => handleCall(currentBooking.customerPhone)}>
                 <Ionicons name="call" size={28} color="green" />
               </TouchableOpacity>
            </View>
            <ScrollView style={{maxHeight: 100}} showsVerticalScrollIndicator={false}>
               <Text style={s.addressText}>📍 {currentBooking.pickup?.address}</Text>
               <Text style={s.addressText}>🏁 {currentBooking.drop?.address}</Text>
            </ScrollView>

            {/* Open in Google Maps — pickup nav while heading to pickup, drop nav while heading to drop */}
            {currentBooking.status === 'accepted' && currentBooking.pickup?.lat && (
              <TouchableOpacity
                style={s.navBtn}
                onPress={() => openInMaps(currentBooking.pickup.lat, currentBooking.pickup.lng, 'Pickup')}
              >
                <Ionicons name="navigate" size={18} color="#FFFFFF" />
                <Text style={s.navBtnText}>Go to Pickup</Text>
              </TouchableOpacity>
            )}
            {currentBooking.status === 'picked_up' && currentBooking.drop?.lat && (
              <TouchableOpacity
                style={s.navBtn}
                onPress={() => openInMaps(currentBooking.drop.lat, currentBooking.drop.lng, 'Dropoff')}
              >
                <Ionicons name="navigate" size={18} color="#FFFFFF" />
                <Text style={s.navBtnText}>Go to Drop</Text>
              </TouchableOpacity>
            )}
            
            {/* Payment confirmation banner — UPI direct, customer marked paid but driver hasn't confirmed */}
            {currentBooking.paymentMethod === 'upi_direct' &&
             currentBooking.paymentStatus === 'customer_paid' && (
              <View style={s.paymentBanner}>
                <View style={{ flex: 1 }}>
                  <Text style={s.paymentBannerTitle}>💳 Customer says they've paid via UPI</Text>
                  <Text style={s.paymentBannerSub}>
                    Check your UPI app for ₹{Math.round((currentBooking.fare?.totalInPaise || 0) / 100)} from {currentBooking.customerName || 'customer'}.
                  </Text>
                </View>
                <TouchableOpacity
                  style={s.paymentConfirmBtn}
                  onPress={async () => {
                    try {
                      await updateDoc(doc(db, 'bookings', currentBooking.id), {
                        paymentStatus: 'driver_confirmed',
                        paymentConfirmedAt: serverTimestamp(),
                      });
                      // Complete booking after payment confirmed
                      await completeBooking(currentBooking);
                    } catch (e) {
                      Alert.alert('Error', e.message);
                    }
                  }}
                >
                  <Text style={s.paymentConfirmBtnTxt}>I Got It</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* If UPI booking and customer hasn't yet marked paid, remind driver */}
            {currentBooking.paymentMethod === 'upi_direct' &&
             !currentBooking.paymentStatus && (
              <View style={s.paymentBannerInfo}>
                <Text style={s.paymentBannerSub}>
                  ℹ️ This is a UPI booking. Customer will pay you directly when ready.
                </Text>
              </View>
            )}

            {/* Cash payment confirmation banner */}
            {(currentBooking.paymentMethod === 'cod' || !currentBooking.paymentMethod) &&
             currentBooking.status === 'awaiting_payment' &&
             currentBooking.paymentStatus !== 'driver_confirmed' && (
              <View style={s.paymentBanner}>
                <View style={{ flex: 1 }}>
                  <Text style={s.paymentBannerTitle}>💵 Collect Cash Payment</Text>
                  <Text style={s.paymentBannerSub}>
                    Collect ₹{Math.round((currentBooking.fare?.totalInPaise || 0) / 100)} cash from {currentBooking.customerName || 'customer'}
                  </Text>
                  {currentBooking.paymentStatus === 'customer_paid' && (
                    <Text style={{ fontSize: 11, color: '#059669', fontWeight: '700', marginTop: 4 }}>
                      ✓ Customer confirmed they paid
                    </Text>
                  )}
                </View>
                <TouchableOpacity
                  style={[s.paymentConfirmBtn, { backgroundColor: '#059669' }]}
                  onPress={() => {
                    Alert.alert(
                      'Confirm Cash Received',
                      `Did you receive ₹${Math.round((currentBooking.fare?.totalInPaise || 0) / 100)} cash from the customer?`,
                      [
                        { text: 'No', style: 'cancel' },
                        {
                          text: 'Yes, Received',
                          onPress: async () => {
                            try {
                              await updateDoc(doc(db, 'bookings', currentBooking.id), {
                                paymentStatus: 'driver_confirmed',
                                paymentConfirmedAt: serverTimestamp(),
                                cashCollectedByDriver: true,
                              });
                              // Now complete the booking
                              await completeBooking(currentBooking);
                            } catch (e) {
                              Alert.alert('Error', e.message);
                            }
                          },
                        },
                      ]
                    );
                  }}
                >
                  <Text style={s.paymentConfirmBtnTxt}>Cash Received</Text>
                </TouchableOpacity>
              </View>
            )}

            {currentBooking.status === 'awaiting_payment' ? (
              <View>
                <View style={s.awaitingPaymentCard}>
                  <Text style={s.awaitingPaymentTitle}>📦 Delivery Verified!</Text>
                  <Text style={s.awaitingPaymentSub}>
                    Collect ₹{Math.round((currentBooking.fare?.totalInPaise || 0) / 100)} via UPI from {currentBooking.customerName || 'customer'}.
                  </Text>
                  <Text style={s.awaitingPaymentHint}>
                    Ask customer to pay your UPI ID. Once you receive the money, tap below.
                  </Text>
                </View>
                {currentBooking.paymentStatus === 'customer_paid' && (
                  <View style={s.paymentBanner}>
                    <Text style={s.paymentBannerTitle}>✅ Customer says they've paid!</Text>
                  </View>
                )}
                <TouchableOpacity
                  style={[s.btn, { backgroundColor: '#10B981' }]}
                  onPress={async () => {
                    setActionLoading(true);
                    try {
                      await updateDoc(doc(db, 'bookings', currentBooking.id), {
                        paymentStatus: 'driver_confirmed',
                        paymentConfirmedAt: serverTimestamp(),
                      });
                      await completeBooking(currentBooking);
                    } catch (e) {
                      Alert.alert('Error', e.message);
                    }
                    setActionLoading(false);
                  }}
                >
                  {actionLoading ? <ActivityIndicator color="#fff" /> : <Text style={s.btnTxt}>PAYMENT RECEIVED — COMPLETE TRIP</Text>}
                </TouchableOpacity>
              </View>
            ) : ['accepted', 'picked_up'].includes(currentBooking.status) ? (
              <TouchableOpacity style={s.btn} onPress={() => updateBookingStatus(currentBooking.status === 'accepted' ? 'arrived' : 'reached_dropoff')}>
                <Text style={s.btnTxt}>I HAVE ARRIVED</Text>
              </TouchableOpacity>
            ) : (
              <View>
                <TextInput style={s.input} value={otpInput} onChangeText={setOtpInput} placeholder="Enter 4-digit OTP" keyboardType="numeric" maxLength={4} />
                <TouchableOpacity style={s.btn} onPress={() => verifyOtp(currentBooking.status === 'arrived' ? 'pickup' : 'delivery')}>
                  {actionLoading ? <ActivityIndicator color="#fff" /> : <Text style={s.btnTxt}>VERIFY OTP</Text>}
                </TouchableOpacity>
              </View>
            )}

            {['accepted', 'arrived'].includes(currentBooking.status) && (
              <TouchableOpacity style={s.cancel} onPress={() => updateDoc(doc(db, 'bookings', currentBooking.id), { status: 'cancelled' })}>
                <Text style={{color: 'red', fontWeight: 'bold'}}>Cancel Trip</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          isOnline && availableBookings.length > 0 ? (
            <View>
              {/* Count + swipe hint */}
              <View style={s.cardCounter}>
                <Text style={s.cardCounterText}>
                  {availableBookings.length} request{availableBookings.length > 1 ? 's' : ''} nearby
                </Text>
                {availableBookings.length > 1 && (
                  <Text style={s.swipeHint}>Swipe →</Text>
                )}
              </View>

              <FlatList 
                data={availableBookings} 
                horizontal 
                pagingEnabled 
                showsHorizontalScrollIndicator={false}
                onScroll={e => setFocusedIndex(Math.round(e.nativeEvent.contentOffset.x / width))} 
                keyExtractor={(item) => item.id}
                renderItem={({item}) => {
                  const tripKm = item.distanceKm ? Number(item.distanceKm).toFixed(1) : null;
                  const pickupKm = item._distanceKm != null ? item._distanceKm.toFixed(1) : null;
                  const pickupPremium = item._pickupPremium;
                  const isCod = item.paymentMethod === 'cod';
                  // Driver's actual fare = base + distance + THEIR pickup premium (not customer's max)
                  const baseFare = (item.fare?.baseFare || 0) / 100;
                  const distanceFare = (item.fare?.distanceFare || 0) / 100;
                  const driverPremium = item._pickupPremium || 0;
                  const actualFare = Math.round(baseFare + distanceFare + driverPremium);
                  return (
                    <View style={s.card}>
                      <View style={s.cardTopRow}>
                        <View style={{ flex: 1 }}>
                          <Text style={s.price}>₹{actualFare}</Text>
                          <Text style={s.reqTitle}>{VLABELS[item.vehicleType] || 'Delivery Request'}</Text>
                        </View>
                        <View style={[s.payTag, isCod ? s.payTagCod : s.payTagUpi]}>
                          <Text style={s.payTagText}>{isCod ? '💵 COD' : '💳 UPI'}</Text>
                        </View>
                      </View>

                      <View style={s.metaRow}>
                        <Text style={s.metaText}>👤 {item.customerName || 'Customer'}</Text>
                        {tripKm && <Text style={s.metaText}>🛣️ Trip {tripKm} km</Text>}
                      </View>

                      {/* Driver-to-pickup distance + pickup premium they'd earn */}
                      {pickupKm != null && (
                        <View style={s.pickupInfoRow}>
                          <View style={s.pickupChip}>
                            <Ionicons name="navigate-outline" size={13} color="#1E40AF" />
                            <Text style={s.pickupChipText}>{pickupKm} km to pickup</Text>
                          </View>
                          {pickupPremium > 0 && (
                            <View style={[s.pickupChip, { backgroundColor: '#ECFDF5' }]}>
                              <Ionicons name="cash-outline" size={13} color="#065F46" />
                              <Text style={[s.pickupChipText, { color: '#065F46' }]}>+₹{pickupPremium} pickup</Text>
                            </View>
                          )}
                        </View>
                      )}

                      <View style={s.addressBlock}>
                        <View style={s.addressRow}>
                          <View style={s.greenDot} />
                          <Text style={s.addressTxt} numberOfLines={2}>{item.pickup?.address || 'Pickup location'}</Text>
                        </View>
                        <View style={s.addressDivider} />
                        <View style={s.addressRow}>
                          <View style={s.redSquare} />
                          <Text style={s.addressTxt} numberOfLines={2}>{item.drop?.address || 'Drop location'}</Text>
                        </View>
                      </View>

                      {item.itemsDescription ? (
                        <Text style={s.itemsTxt} numberOfLines={1}>📦 {item.itemsDescription}</Text>
                      ) : null}

                      {/* Accept + Reject row */}
                      <View style={s.actionRow}>
                        <TouchableOpacity 
                          style={s.rejectBtn} 
                          onPress={() => {
                            updateDoc(doc(db, 'bookings', item.id), {
                              rejectedByDrivers: arrayUnion(user.uid)
                            });
                          }}
                        >
                          <Ionicons name="close" size={18} color="#EF4444" />
                          <Text style={s.rejectBtnText}>Reject</Text>
                        </TouchableOpacity>
                        <TouchableOpacity 
                          style={s.acceptBtn}
                          onPress={async () => {
                            try {
                              const bookingRef = doc(db, 'bookings', item.id);
                              await runTransaction(db, async (tx) => {
                                const snap = await tx.get(bookingRef);
                                if (!snap.exists()) throw new Error('Booking no longer exists');
                                const data = snap.data();
                                if (data.status !== 'searching') throw new Error('Already taken by another driver');
                                if (data.driverId) throw new Error('Already accepted');
                                tx.update(bookingRef, {
                                  status: 'accepted',
                                  driverId: user.uid,
                                  driverName: driverDoc?.kyc?.fullName || profile?.name || 'Driver',
                                  driverPhone: profile?.phone || '',
                                  driverUpiId: driverDoc?.kyc?.upiId || '',
                                  driverVehicleLabel: driverDoc?.vehicle?.label || '',
                                  driverVehicleNumber: driverDoc?.vehicle?.number || '',
                                  driverVehicleModel: driverDoc?.vehicle?.model || '',
                                  acceptedAt: serverTimestamp(),
                                });
                              });
                            } catch (e) {
                              Alert.alert('Could not accept', e.message || 'This booking may have been taken.');
                            }
                          }}
                        >
                          <Ionicons name="checkmark" size={18} color="#FFF" />
                          <Text style={s.acceptBtnText}>Accept</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                }} 
              />

              {/* Pagination dots */}
              {availableBookings.length > 1 && (
                <View style={s.dotsRow}>
                  {availableBookings.map((_, idx) => (
                    <View 
                      key={idx} 
                      style={[
                        s.dot, 
                        idx === focusedIndex && s.dotActive
                      ]} 
                    />
                  ))}
                </View>
              )}
            </View>
          ) : (
            <View style={s.panel}>
                {isBlocked ? (
                  <View style={s.blockedBanner}>
                    <Text style={s.blockedTitle}>🚫 Account Blocked</Text>
                    <Text style={s.blockedSub}>Your account has been blocked by admin. Contact support for details.</Text>
                  </View>
                ) : isCommissionBlocked ? (
                  driverDoc?.commissionPaymentClaimedAt ? (
                    <View style={s.paymentVerifyingBanner}>
                      <Ionicons name="hourglass" size={20} color="#D97706" />
                      <View style={{ flex: 1, marginLeft: 12 }}>
                        <Text style={s.paymentVerifyingTitle}>⏳ Payment Verification In Progress</Text>
                        <Text style={s.paymentVerifyingText}>
                          Admin is verifying your ₹{pendingCommissionRupees} payment. This usually takes 15-30 minutes.
                        </Text>
                        <Text style={s.paymentVerifyingHint}>
                          You'll be automatically unblocked once verified.
                        </Text>
                      </View>
                    </View>
                  ) : (
                    <View style={s.commissionBanner}>
                      <Text style={s.commissionTitle}>💰 Commission Due — ₹{pendingCommissionRupees}</Text>
                      <Text style={s.commissionSub}>You owe more than the ₹{maxOwedRupees} limit. Pay your dues to go online.</Text>
                      <TouchableOpacity style={s.payCommissionBtn} onPress={payCommission}>
                        <Text style={s.payCommissionBtnTxt}>Pay ₹{pendingCommissionRupees} via UPI</Text>
                      </TouchableOpacity>
                    </View>
                  )
                ) : (
                  <Text style={s.centerTxt}>
                    {!isKycApproved 
                        ? "Complete KYC to see requests" 
                        : (isOnline ? "Searching for requests nearby..." : "You are currently Offline")}
                  </Text>
                )}

                {/* Show pending commission reminder even if not blocked */}
                {pendingCommissionRupees > 0 && !currentBooking && (
                  <TouchableOpacity 
                    style={[
                      s.commissionReminder,
                      pendingCommissionRupees > (maxOwedRupees * 0.8) && { backgroundColor: '#FEF2F2', borderColor: '#FECACA' }
                    ]}
                    onPress={payCommission}
                  >
                    <Text style={[
                      s.commissionReminderTxt,
                      pendingCommissionRupees > (maxOwedRupees * 0.8) && { color: '#991B1B' }
                    ]}>
                      {pendingCommissionRupees > (maxOwedRupees * 0.8) 
                        ? `⚠️ URGENT: You owe ₹${pendingCommissionRupees} (limit ₹${maxOwedRupees}) — Pay now!`
                        : `💰 You owe ₹${pendingCommissionRupees} commission — Tap to pay`
                      }
                    </Text>
                  </TouchableOpacity>
                )}
            </View>
          )
        )}
      </KeyboardAvoidingView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#eee' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  map: { width: width, height: height, position: 'absolute' },
  header: { position: 'absolute', top: 0, width: '100%', padding: 10 },
  headerBox: { backgroundColor: '#fff', padding: 15, borderRadius: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', elevation: 5, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 10 },
  title: { fontSize: 18, fontWeight: 'bold' },
  bottom: { position: 'absolute', bottom: 0, width: '100%' },
  panel: { backgroundColor: '#fff', padding: 20, borderTopLeftRadius: 24, borderTopRightRadius: 24, elevation: 10, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 15 },
  customerBox: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginVertical: 15 },
  name: { fontSize: 20, fontWeight: 'bold' },
  statusTxt: { color: 'green', fontWeight: 'bold', letterSpacing: 1 },
  addressText: { fontSize: 14, color: '#444', marginBottom: 8 },
  btn: { backgroundColor: '#000', padding: 18, borderRadius: 12, alignItems: 'center', marginTop: 10 },
  btnTxt: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  paymentBanner: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, backgroundColor: '#ECFDF5', borderRadius: 12, borderWidth: 1, borderColor: '#A7F3D0', marginBottom: 12 },
  paymentBannerInfo: { padding: 10, backgroundColor: '#EFF6FF', borderRadius: 10, borderWidth: 1, borderColor: '#DBEAFE', marginBottom: 12 },
  paymentBannerTitle: { fontSize: 13, fontWeight: '800', color: '#065F46', marginBottom: 2 },
  paymentBannerSub: { fontSize: 11, color: '#374151', fontWeight: '500' },
  paymentConfirmBtn: { backgroundColor: '#10B981', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10 },
  paymentConfirmBtnTxt: { color: '#FFFFFF', fontSize: 12, fontWeight: '800', letterSpacing: 0.3 },
  awaitingPaymentCard: { backgroundColor: '#FEF3C7', borderRadius: 14, padding: 16, borderWidth: 1.5, borderColor: '#FDE68A', marginBottom: 14 },
  awaitingPaymentTitle: { fontSize: 16, fontWeight: '900', color: '#92400E', marginBottom: 4 },
  awaitingPaymentSub: { fontSize: 14, fontWeight: '700', color: '#78350F', marginBottom: 6 },
  awaitingPaymentHint: { fontSize: 12, fontWeight: '500', color: '#92400E' },
  blockedBanner: { backgroundColor: '#FEF2F2', borderRadius: 14, padding: 16, borderWidth: 1.5, borderColor: '#FECACA', alignItems: 'center' },
  blockedTitle: { fontSize: 16, fontWeight: '900', color: '#991B1B', marginBottom: 4 },
  blockedSub: { fontSize: 13, fontWeight: '500', color: '#B91C1C', textAlign: 'center' },
  commissionBanner: { backgroundColor: '#FEF3C7', borderRadius: 14, padding: 16, borderWidth: 1.5, borderColor: '#FDE68A', alignItems: 'center' },
  paymentVerifyingBanner: { 
    backgroundColor: '#FEF3C7', 
    borderRadius: 14, 
    padding: 16, 
    borderWidth: 1.5, 
    borderColor: '#FDE68A', 
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  paymentVerifyingTitle: { fontSize: 14, fontWeight: '800', color: '#92400E', marginBottom: 4 },
  paymentVerifyingText: { fontSize: 12, color: '#78350F', lineHeight: 16, marginBottom: 4 },
  paymentVerifyingHint: { fontSize: 11, color: '#92400E', fontStyle: 'italic' },
  commissionTitle: { fontSize: 16, fontWeight: '900', color: '#92400E', marginBottom: 4 },
  commissionSub: { fontSize: 12, fontWeight: '500', color: '#78350F', textAlign: 'center', marginBottom: 12 },
  payCommissionBtn: { backgroundColor: '#10B981', borderRadius: 12, paddingHorizontal: 24, paddingVertical: 12 },
  payCommissionBtnTxt: { color: '#FFFFFF', fontSize: 14, fontWeight: '800', letterSpacing: 0.3 },
  commissionReminder: { backgroundColor: '#FEF3C7', borderRadius: 10, padding: 10, marginTop: 12, borderWidth: 1, borderColor: '#FDE68A' },
  commissionReminderTxt: { fontSize: 12, fontWeight: '700', color: '#92400E', textAlign: 'center' },
  navBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#3B82F6', paddingVertical: 13, borderRadius: 12, marginTop: 10 },
  navBtnText: { color: '#FFFFFF', fontWeight: '800', fontSize: 14, letterSpacing: 0.2 },
  input: { borderBottomWidth: 2, borderColor: '#eee', padding: 10, textAlign: 'center', fontSize: 24, fontWeight: 'bold', marginBottom: 10 },
  card: { width: width - 40, margin: 20, backgroundColor: '#fff', padding: 20, borderRadius: 24, elevation: 5, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 10 },
  cardTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  price: { fontSize: 28, fontWeight: '800', color: '#10B981' },
  reqTitle: { fontSize: 15, fontWeight: '700', color: '#111827', marginTop: 2 },
  payTag: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  payTagUpi: { backgroundColor: '#EFF6FF' },
  payTagCod: { backgroundColor: '#FEF3C7' },
  payTagText: { fontSize: 12, fontWeight: '700', color: '#1F2937' },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10, marginBottom: 10 },
  metaText: { fontSize: 13, color: '#4B5563', fontWeight: '600' },
  pickupInfoRow: { flexDirection: 'row', gap: 8, marginBottom: 10, flexWrap: 'wrap' },
  pickupChip: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#EFF6FF', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  pickupChipText: { fontSize: 12, fontWeight: '700', color: '#1E40AF' },
  addressBlock: { backgroundColor: '#F9FAFB', borderRadius: 12, padding: 12, marginBottom: 10 },
  addressRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  greenDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#10B981', marginTop: 5 },
  redSquare: { width: 10, height: 10, borderRadius: 3, backgroundColor: '#EF4444', marginTop: 5 },
  addressTxt: { flex: 1, fontSize: 13, color: '#374151', fontWeight: '500' },
  addressDivider: { height: 12, width: 2, backgroundColor: '#E5E7EB', marginLeft: 4, marginVertical: 2 },
  itemsTxt: { fontSize: 12, color: '#10B981', fontWeight: '600', backgroundColor: '#10B98115', padding: 8, borderRadius: 8, marginBottom: 10 },

  // Accept/Reject row
  actionRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  rejectBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#FEF2F2', paddingVertical: 14, borderRadius: 12, borderWidth: 1, borderColor: '#FECACA' },
  rejectBtnText: { color: '#EF4444', fontWeight: '700', fontSize: 14 },
  acceptBtn: { flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#111827', paddingVertical: 14, borderRadius: 12 },
  acceptBtnText: { color: '#FFFFFF', fontWeight: '800', fontSize: 14 },

  // Counter + dots
  cardCounter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginHorizontal: 20, marginTop: 8 },
  cardCounterText: { fontSize: 13, fontWeight: '700', color: '#111827', backgroundColor: '#FFFFFF', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 4, elevation: 2 },
  swipeHint: { fontSize: 12, fontWeight: '700', color: '#10B981', backgroundColor: '#FFFFFF', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 4, elevation: 2 },
  dotsRow: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginBottom: 10 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#D1D5DB' },
  dotActive: { width: 18, backgroundColor: '#111827' },

  // Locate-me button
  locateBtn: { position: 'absolute', right: 16, top: Platform.OS === 'android' ? 110 : 90, width: 46, height: 46, borderRadius: 23, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 10, zIndex: 100 },

  cancel: { marginTop: 20, alignItems: 'center', padding: 10 },
  centerTxt: { textAlign: 'center', fontSize: 16, color: '#666', fontWeight: '500' }
});