import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  SafeAreaView,
  Dimensions,
  Linking,
} from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { addDoc, collection, serverTimestamp, doc, onSnapshot, updateDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions, auth, GOOGLE_MAPS_API_KEY } from '../../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { useAppSettings } from '../../hooks/useAppSettings';
import { SOSButton } from '../../components/SOSButton';

const { width, height } = Dimensions.get('window');
const GOOGLE_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || GOOGLE_MAPS_API_KEY;

const DEFAULT_REGION = { latitude: 19.076, longitude: 72.8777, latitudeDelta: 0.055, longitudeDelta: 0.055 };
const SERVICES = [
  { id: 'parcel', label: 'Send Package' },
  { id: 'ride', label: 'Book a Ride' },
];

const quoteFare = httpsCallable(functions, 'quoteFare');
const generateOtp = () => Math.floor(1000 + Math.random() * 9000).toString();
const generateSessionToken = () => Math.random().toString(36).substring(2) + Date.now().toString(36);

const vehicleIconName = (vehicleId = '') => {
  const id = vehicleId.toLowerCase();
  if (id.includes('bike') || id.includes('scooty')) return 'bicycle';
  if (id.includes('3wheeler') || id.includes('auto')) return 'car-sport-outline';
  if (id.includes('hatti') || id.includes('tempo')) return 'bus-outline';
  if (id.includes('7') || id.includes('seater') || id.includes('suv')) return 'people-outline';
  if (id.includes('hatchback')) return 'car-outline';
  return 'car';
};

function formatAddress(place, fallback) {
  if (!place) return fallback;
  return [place.name, place.street, place.district, place.city, place.region, place.postalCode].filter(Boolean).join(', ') || fallback;
}

const getFriendlyStatus = (status) => {
  switch (status) {
    case 'searching': return 'Looking for nearby drivers...';
    case 'accepted': return 'Driver is on the way';
    case 'arrived': return 'Driver has arrived at pickup';
    case 'picked_up': return 'In transit to dropoff';
    case 'reached': 
    case 'reached_dropoff': return 'Driver reached dropoff';
    case 'awaiting_payment': return 'Pay the driver';
    case 'completed': return 'Booking completed';
    case 'cancelled': 
    case 'cancelled_by_customer': return 'Booking cancelled';
    default: return `Status: ${status}`;
  }
};

export default function CustomerHome() {
  const { user, profile } = useAuth();
  const { settings } = useAppSettings();
  const mapRef = useRef(null);
  const regionRef = useRef(DEFAULT_REGION);

  const [bookingPhase, setBookingPhase] = useState('pickup'); 
  const [serviceType, setServiceType] = useState('parcel');
  const [selectedVehicle, setSelectedVehicle] = useState('');
  const [pickupLocation, setPickupLocation] = useState(null);
  const [dropLocation, setDropLocation] = useState(null);
  const [itemsDescription, setItemsDescription] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('cod');

  const [mapRegion, setMapRegion] = useState(DEFAULT_REGION);
  const [mapMarker, setMapMarker] = useState({ latitude: DEFAULT_REGION.latitude, longitude: DEFAULT_REGION.longitude });
  const [placeQuery, setPlaceQuery] = useState('');
  const [manualAddress, setManualAddress] = useState('');
  const [placeResults, setPlaceResults] = useState([]);
  const [placesLoading, setPlacesLoading] = useState(false);
  const [isPinDragged, setIsPinDragged] = useState(false);
  const [sessionToken, setSessionToken] = useState(generateSessionToken());
  const [mapLoading, setMapLoading] = useState(false);

  const [fareQuote, setFareQuote] = useState(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  
  const [currentBookingId, setCurrentBookingId] = useState(null);
  const [activeBooking, setActiveBooking] = useState(null);
  const [isMinimized, setIsMinimized] = useState(false);

  const vehicleOptions = useMemo(() => {
    const source = serviceType === 'parcel' ? settings.parcelVehicles : settings.rideVehicles;
    return (source || []).filter(v => v.enabled !== false);
  }, [serviceType, settings.parcelVehicles, settings.rideVehicles]);

  const selectedVehicleData = useMemo(() => vehicleOptions.find(v => v.id === selectedVehicle) || vehicleOptions[0] || {}, [selectedVehicle, vehicleOptions]);
  const totalFare = fareQuote?.fare ? Math.round((fareQuote.fare.totalInPaise || 0) / 100) : 0;

  useEffect(() => {
    if (!currentBookingId) {
      setActiveBooking(null);
      return;
    }
    const unsubscribe = onSnapshot(doc(db, 'bookings', currentBookingId), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setActiveBooking({ id: docSnap.id, ...data });
        if (data.status === 'cancelled' || data.status === 'completed') {
           Alert.alert("Booking Update", `This booking is marked as ${data.status}.`);
           resetToHome();
        }
      }
    });
    return () => unsubscribe();
  }, [currentBookingId]);

  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') return;
        const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        const region = { latitude: current.coords.latitude, longitude: current.coords.longitude, latitudeDelta: 0.015, longitudeDelta: 0.015 };
        setMapRegion(region);
        regionRef.current = region;
        setMapMarker({ latitude: region.latitude, longitude: region.longitude });
      } catch {}
    })();
  }, []);

  useEffect(() => {
    if (bookingPhase === 'fare' && pickupLocation && dropLocation && mapRef.current) {
      mapRef.current.fitToCoordinates(
        [{ latitude: pickupLocation.lat, longitude: pickupLocation.lng }, { latitude: dropLocation.lat, longitude: dropLocation.lng }],
        { edgePadding: { top: 80, right: 60, bottom: height * 0.55, left: 60 }, animated: true }
      );
    }
  }, [bookingPhase, pickupLocation, dropLocation]);

  useEffect(() => {
    if (bookingPhase !== 'fare' || !pickupLocation || !dropLocation || !selectedVehicle) return;
    let cancelled = false;
    setQuoteLoading(true);

    const timer = setTimeout(async () => {
      try {
        await auth.currentUser?.getIdToken(true);
        const result = await quoteFare({
          serviceType, vehicleType: selectedVehicle,
          pickup: { lat: pickupLocation.lat, lng: pickupLocation.lng },
          drop: { lat: dropLocation.lat, lng: dropLocation.lng },
        });
        if (!cancelled) setFareQuote(result.data);
      } catch (error) {
        if (!cancelled) {
          setFareQuote(null);
          // Don't pop up alert on auto-quote — log silently. User sees inline error in the fare card.
          console.warn('Fare quote failed:', error.message);
        }
      } finally {
        if (!cancelled) setQuoteLoading(false);
      }
    }, 500);

    return () => { cancelled = true; clearTimeout(timer); };
  }, [bookingPhase, dropLocation, pickupLocation, selectedVehicle, serviceType]);

  const fetchPlacePredictions = async (text) => {
    if (!text || text.trim().length < 3) return setPlaceResults([]);
    setPlacesLoading(true);
    try {
      const response = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': GOOGLE_API_KEY, 'X-Goog-FieldMask': 'suggestions.placePrediction.placeId,suggestions.placePrediction.text,suggestions.placePrediction.structuredFormat' },
        body: JSON.stringify({ input: text.trim(), includedRegionCodes: ['in'], languageCode: 'en', sessionToken }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error();
      const predictions = (json.suggestions || []).map(item => ({
        place_id: item.placePrediction.placeId,
        main_text: item.placePrediction.structuredFormat?.mainText?.text || item.placePrediction.text?.text || '',
        secondary_text: item.placePrediction.structuredFormat?.secondaryText?.text || '',
      }));
      setPlaceResults(predictions);
    } catch {
      setPlaceResults([]);
    } finally {
      setPlacesLoading(false);
    }
  };

  useEffect(() => {
    const query = placeQuery.trim();
    if (query.length < 3 || bookingPhase === 'fare' || bookingPhase === 'active') return setPlaceResults([]);
    const timer = setTimeout(() => fetchPlacePredictions(query), 600);
    return () => clearTimeout(timer);
  }, [placeQuery, bookingPhase]);

  const moveMapTo = (coordinate, delta = 0.005) => {
    setIsPinDragged(false);
    const region = { ...coordinate, latitudeDelta: delta, longitudeDelta: delta };
    regionRef.current = region;
    setMapMarker(coordinate);
    mapRef.current?.animateToRegion(region, 400);
  };

  const useCurrentLocation = async () => {
    try {
      setMapLoading(true);
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission denied', 'Location permission is required to use this feature.');
        return;
      }
      const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const coord = { latitude: current.coords.latitude, longitude: current.coords.longitude };
      moveMapTo(coord);
      // Reverse geocode and prefill the search bar
      try {
        const places = await Location.reverseGeocodeAsync(coord);
        const address = formatAddress(places?.[0], '');
        if (address) setPlaceQuery(address);
      } catch {}
    } catch (e) {
      Alert.alert('Error', 'Could not get current location.');
    } finally {
      setMapLoading(false);
    }
  };

  const selectPlace = async (place_id) => {
    setPlacesLoading(true);
    try {
      const response = await fetch(`https://places.googleapis.com/v1/places/${place_id}?sessionToken=${sessionToken}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': GOOGLE_API_KEY, 'X-Goog-FieldMask': 'formattedAddress,location' },
      });
      const json = await response.json();
      setPlaceQuery(json.formattedAddress);
      setPlaceResults([]);
      moveMapTo({ latitude: json.location.latitude, longitude: json.location.longitude });
    } catch (error) {
      Alert.alert("Error", "Could not fetch place details.");
    } finally {
      setPlacesLoading(false);
    }
  };

  const handleMapDragEnd = async (region) => {
    setIsPinDragged(true);
    setMapMarker({ latitude: region.latitude, longitude: region.longitude });
    try {
      const places = await Location.reverseGeocodeAsync({ latitude: region.latitude, longitude: region.longitude });
      const address = formatAddress(places?.[0], '');
      if (address) setPlaceQuery(address);
    } catch (e) {}
  };

  const confirmLocation = async () => {
    setMapLoading(true);
    try {
      const flatNo = manualAddress.trim();
      let finalAddress = placeQuery;

      if (!placeQuery) {
        const places = await Location.reverseGeocodeAsync({ latitude: mapMarker.latitude, longitude: mapMarker.longitude });
        finalAddress = formatAddress(places?.[0], `${mapMarker.latitude.toFixed(5)}, ${mapMarker.longitude.toFixed(5)}`);
      }
      
      const fullAddress = flatNo ? `${flatNo}, ${finalAddress}` : finalAddress;
      const selected = { address: fullAddress, lat: mapMarker.latitude, lng: mapMarker.longitude };

      if (bookingPhase === 'pickup') {
        setPickupLocation(selected);
        setBookingPhase('drop');
        setPlaceQuery('');
        setManualAddress('');
        setSessionToken(generateSessionToken());
      } else if (bookingPhase === 'drop') {
        setDropLocation(selected);
        setBookingPhase('fare');
      }
    } catch (error) {
      Alert.alert('Error', 'Could not save location');
    } finally {
      setMapLoading(false);
    }
  };

  const handleCreateBooking = async () => {
    if (serviceType === 'parcel' && !itemsDescription.trim()) return Alert.alert('Required', 'Describe your parcel items');
    if (!fareQuote?.fare) return Alert.alert('Required', 'Please wait for fare calculation');

    setActionLoading(true);
    try {
      const quoteCommission = fareQuote.commission || {};
      const docRef = await addDoc(collection(db, 'bookings'), {
        serviceType, service: serviceType,
        customerId: user?.uid || '', customerName: profile?.name || 'Customer', customerPhone: profile?.phone || '',
        vehicleType: selectedVehicle, vehicleLabel: selectedVehicleData.label,
        pickup: pickupLocation, drop: dropLocation,
        itemsDescription: serviceType === 'parcel' ? itemsDescription.trim() : '',
        paymentMethod, distanceKm: fareQuote.distanceKm, fare: fareQuote.fare,
        commission: { amountInPaise: quoteCommission.amountInPaise || 0, pct: quoteCommission.pct || 0, status: paymentMethod === 'razorpay' ? 'collected' : 'pending_from_driver' },
        // Payment status: cod gets confirmed at delivery; upi/razorpay before
        paymentStatus: 'pending', // pending → customer_paid → driver_confirmed
        status: 'searching', 
        pickupOtp: generateOtp(), deliveryOtp: generateOtp(),
        createdAt: serverTimestamp(),
      });

      setCurrentBookingId(docRef.id);
      setBookingPhase('active');
      setIsMinimized(false);
    } catch (error) {
      Alert.alert('Error', error.message || 'Booking failed');
    } finally {
      setActionLoading(false);
    }
  };

  const cancelBooking = async () => {
    if (!currentBookingId) return;
    setActionLoading(true);
    try {
      await updateDoc(doc(db, 'bookings', currentBookingId), { status: 'cancelled_by_customer' });
      resetToHome();
    } catch (error) {
      Alert.alert("Error", "Could not cancel booking.");
    } finally {
      setActionLoading(false);
    }
  };

  const resetToHome = () => {
    setBookingPhase('pickup');
    setPickupLocation(null);
    setDropLocation(null);
    setFareQuote(null);
    setCurrentBookingId(null);
    setActiveBooking(null);
    setPlaceQuery('');
    setManualAddress('');
    setItemsDescription('');
    setIsMinimized(false);
  };

  const goBack = () => {
    if (bookingPhase === 'pickup') {
      resetToHome();
    } else if (bookingPhase === 'drop') {
      setBookingPhase('pickup');
      setDropLocation(null);
      setPlaceQuery(pickupLocation?.address || '');
      moveMapTo({ latitude: pickupLocation.lat, longitude: pickupLocation.lng });
    } else if (bookingPhase === 'fare') {
      setBookingPhase('drop');
      setPlaceQuery(dropLocation?.address || '');
      moveMapTo({ latitude: dropLocation.lat, longitude: dropLocation.lng });
    }
  };

  const renderSearchPhase = () => (
    <View style={styles.bottomSheet}>
      {/* Floating "Use Current Location" button — sits above the sheet, moves with it */}
      <TouchableOpacity
        style={styles.locateBtn}
        onPress={useCurrentLocation}
        activeOpacity={0.85}
      >
        <Ionicons name="locate" size={22} color="#111827" />
      </TouchableOpacity>

      <View style={styles.sheetHeader}>
        {bookingPhase === 'drop' && (
          <TouchableOpacity style={styles.backBtn} onPress={goBack}>
            <Ionicons name="arrow-back" size={24} color="#111827" />
          </TouchableOpacity>
        )}
        <Text style={styles.sheetTitle}>{bookingPhase === 'pickup' ? 'Where from?' : 'Where to?'}</Text>
      </View>
      
      <View style={styles.searchBar}>
        <Ionicons name={bookingPhase === 'pickup' ? 'location' : 'flag'} size={20} color={bookingPhase === 'pickup' ? '#10B981' : '#EF4444'} />
        <TextInput
          style={styles.searchInputArea}
          value={placeQuery}
          onChangeText={(text) => { setPlaceQuery(text); setIsPinDragged(false); }}
          placeholder="Search area, street, landmark..."
          placeholderTextColor="#9CA3AF"
        />
        {placesLoading ? <ActivityIndicator size="small" color="#111827" /> : 
          placeQuery.length > 0 && (
            <TouchableOpacity onPress={() => setPlaceQuery('')}>
              <Ionicons name="close-circle" size={20} color="#D1D5DB" />
            </TouchableOpacity>
          )}
      </View>

      {placeResults.length > 0 ? (
        <FlatList
          data={placeResults}
          keyExtractor={item => item.place_id}
          keyboardShouldPersistTaps="handled"
          style={styles.searchResultsList}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.searchResultRow} onPress={() => selectPlace(item.place_id)}>
              <View style={styles.resultIconBg}>
                <Ionicons name="location-outline" size={18} color="#6B7280" />
              </View>
              <View style={styles.resultTextBlock}>
                <Text style={styles.resMain} numberOfLines={1}>{item.main_text}</Text>
                <Text style={styles.resSub} numberOfLines={1}>{item.secondary_text}</Text>
              </View>
            </TouchableOpacity>
          )}
        />
      ) : mapMarker ? (
        <View style={styles.manualAddressWrapper}>
          <TextInput
            style={styles.manualInput}
            value={manualAddress}
            onChangeText={setManualAddress}
            placeholder="House/Flat No., Building Name (Optional)"
            placeholderTextColor="#9CA3AF"
          />
        </View>
      ) : null}

      <TouchableOpacity style={styles.confirmLocBtn} onPress={confirmLocation} disabled={mapLoading}>
        {mapLoading ? <ActivityIndicator color="#FFF" /> : <Text style={styles.confirmLocText}>Confirm {bookingPhase === 'pickup' ? 'Pickup' : 'Dropoff'}</Text>}
      </TouchableOpacity>
    </View>
  );

  const renderFarePhase = () => (
    <View style={styles.fareSheetContainer}>
      <View style={styles.sheetHeaderFixed}>
        <TouchableOpacity style={styles.backBtn} onPress={goBack}>
          <Ionicons name="arrow-back" size={24} color="#111827" />
        </TouchableOpacity>
        <Text style={styles.sheetTitleFixed}>Confirm Booking</Text>
      </View>

      <ScrollView style={styles.scrollableMiddle} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 16 }}>
        <View style={styles.routeSummaryBox}>
          <View style={styles.routeSummaryRow}>
            <View style={styles.greenDot} />
            <Text style={styles.routeSummaryText} numberOfLines={3}>{pickupLocation?.address}</Text>
          </View>
          <View style={styles.routeSummaryDivider} />
          <View style={styles.routeSummaryRow}>
            <View style={styles.redSquare} />
            <Text style={styles.routeSummaryText} numberOfLines={3}>{dropLocation?.address}</Text>
          </View>
        </View>

        {serviceType === 'parcel' && (
          <TextInput style={styles.packageInput} value={itemsDescription} onChangeText={setItemsDescription} placeholder="What are you sending? E.g. Documents, Clothes..." placeholderTextColor="#9CA3AF" />
        )}

        <Text style={styles.sheetTitleSmall}>Select Vehicle</Text>

        {vehicleOptions.length === 0 ? (
          <View style={styles.emptyVehicles}><ActivityIndicator color="#111827" /><Text style={styles.emptyVehiclesText}>Loading vehicles...</Text></View>
        ) : (
          <View style={styles.vehicleList}>
            {vehicleOptions.map(v => {
              const active = selectedVehicle === v.id;
              return (
                <TouchableOpacity
                  key={v.id}
                  style={[styles.vehicleListRow, active && styles.vehicleListRowActive]}
                  onPress={() => setSelectedVehicle(v.id)}
                  activeOpacity={0.7}
                >
                  <View style={[styles.vehicleListIcon, active && styles.vehicleListIconActive]}>
                    <Ionicons name={vehicleIconName(v.id)} size={16} color={active ? '#111827' : '#6B7280'} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.vehicleListName, active && styles.vehicleListNameActive]} numberOfLines={1}>{v.label}</Text>
                    {v.capacity ? <Text style={styles.vehicleListCap} numberOfLines={1}>{v.capacity}</Text> : null}
                  </View>
                  <Text style={[styles.vehicleListPrice, active && styles.vehicleListPriceActive]}>₹{v.baseFare}+</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        <View style={styles.receiptBox}>
          {fareQuote?.fare ? (
            <>
              <View style={styles.receiptRow}>
                <Text style={styles.receiptLabel}>Base Fare</Text>
                <Text style={styles.receiptValue}>₹{Math.round((fareQuote.fare.baseFare || 0) / 100)}</Text>
              </View>
              <View style={styles.receiptRow}>
                <Text style={styles.receiptLabel}>
                  Distance{fareQuote.distanceKm ? ` (${fareQuote.distanceKm} km)` : ''}
                </Text>
                <Text style={styles.receiptValue}>₹{Math.round((fareQuote.fare.distanceFare || 0) / 100)}</Text>
              </View>

              {/* Pickup premium row — only show if there is one */}
              {(fareQuote.fare.pickupPremium || 0) > 0 && (
                <View style={styles.receiptRow}>
                  <Text style={styles.receiptLabel}>
                    Pickup (max)
                  </Text>
                  <Text style={styles.receiptValue}>
                    +₹{Math.round((fareQuote.fare.pickupPremium || 0) / 100)}
                  </Text>
                </View>
              )}

              <View style={styles.receiptDivider} />

              {/* If we got a range from the cloud function, show "₹X–₹Y" */}
              {fareQuote.fareRange ? (
                <>
                  <View style={styles.receiptRow}>
                    <Text style={styles.receiptTotalLabel}>Total Fare</Text>
                    <Text style={styles.receiptTotalValue}>
                      ₹{Math.round(fareQuote.fareRange.minInPaise / 100)}–₹{Math.round(fareQuote.fareRange.maxInPaise / 100)}
                    </Text>
                  </View>
                  <Text style={styles.fareRangeNote}>Final price depends on driver distance from pickup.</Text>
                </>
              ) : (
                <View style={styles.receiptRow}>
                  <Text style={styles.receiptTotalLabel}>Total Fare</Text>
                  <Text style={styles.receiptTotalValue}>₹{totalFare}</Text>
                </View>
              )}

              {/* Pickup ETA */}
              {(fareQuote.pickupEtaRange || fareQuote.etaRange) && (
                <View style={[styles.receiptRow, { marginTop: 8 }]}>
                  <Text style={styles.receiptLabel}>Pickup in</Text>
                  <Text style={styles.receiptValue}>
                    {fareQuote.pickupEtaRange
                      ? `${fareQuote.pickupEtaRange.minMinutes}–${fareQuote.pickupEtaRange.maxMinutes} min`
                      : `${fareQuote.etaRange.minMinutes}–${fareQuote.etaRange.maxMinutes} min`}
                  </Text>
                </View>
              )}
            </>
          ) : (
            <View style={styles.receiptRow}>
              <Text style={styles.receiptTotalLabel}>Total Fare</Text>
              {quoteLoading ? <ActivityIndicator size="small" color="#111827" /> : <Text style={styles.receiptTotalValue}>₹{totalFare}</Text>}
            </View>
          )}
        </View>
      </ScrollView>

      <View style={styles.pinnedBottom}>
        {/* Payment method chips — dynamically rendered based on admin settings */}
        {(() => {
          const pmSettings = settings.paymentMethods || {};
          const enabledMethods = Object.entries(pmSettings).filter(([, m]) => m.enabled);
          // Auto-select default if current selection is disabled
          if (enabledMethods.length > 0 && !enabledMethods.find(([k]) => k === paymentMethod)) {
            // Side-effect inside render is naughty but acceptable here — we want self-correction
            setTimeout(() => setPaymentMethod(enabledMethods[0][0]), 0);
          }
          if (enabledMethods.length <= 1) return null; // hide chips if only one method
          const ICONS = { cod: '💵', upi_direct: '💳', razorpay: '🔷' };
          const SHORT_LABELS = { cod: 'Cash', upi_direct: 'UPI', razorpay: 'Razorpay' };
          return (
            <View style={styles.payChipsRow}>
              {enabledMethods.map(([key]) => (
                <TouchableOpacity
                  key={key}
                  style={[styles.payChip, paymentMethod === key && styles.payChipActive]}
                  onPress={() => setPaymentMethod(key)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.payChipEmoji}>{ICONS[key] || '💳'}</Text>
                  <Text style={[styles.payChipText, paymentMethod === key && styles.payChipTextActive]}>
                    {SHORT_LABELS[key] || key}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          );
        })()}

        <TouchableOpacity style={[styles.actionButton, actionLoading && styles.disabledBtn]} onPress={handleCreateBooking} disabled={actionLoading || quoteLoading || vehicleOptions.length === 0}>
          {actionLoading ? <ActivityIndicator color="#FFF" /> : <Text style={styles.actionButtonText}>Confirm & Book</Text>}
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderActiveBooking = () => {
    if (!activeBooking) return null;

    const isPostPickup = ['picked_up', 'reached', 'reached_dropoff', 'awaiting_payment', 'completed'].includes(activeBooking.status);
    const isAtDropoff = ['reached', 'reached_dropoff', 'awaiting_payment', 'completed'].includes(activeBooking.status);

    if (isMinimized) {
      return (
        <View style={styles.minimizedSheet}>
          <TouchableOpacity style={styles.minimizedRow} onPress={() => setIsMinimized(false)}>
            <View style={styles.minimizedLeft}>
              <ActivityIndicator size="small" color="#10B981" />
              <Text style={styles.statusText}>{getFriendlyStatus(activeBooking.status)}</Text>
            </View>
            <Ionicons name="chevron-up" size={24} color="#111827" />
          </TouchableOpacity>
        </View>
      );
    }

    return (
      <View style={styles.bottomSheet}>
        <View style={styles.activeHeaderRow}>
          <View style={styles.statusHeaderExpanded}>
            <ActivityIndicator color="#10B981" />
            <Text style={styles.statusText}>{getFriendlyStatus(activeBooking.status)}</Text>
          </View>
          <TouchableOpacity onPress={() => setIsMinimized(true)} style={styles.minimizeBtn}>
            <Ionicons name="chevron-down" size={24} color="#111827" />
          </TouchableOpacity>
        </View>

        <ScrollView style={{ flexGrow: 0 }} showsVerticalScrollIndicator={false}>

        {activeBooking.status === 'awaiting_payment' ? (
          <View style={styles.paymentCard}>
            <View style={styles.paymentCardHeader}>
              <Text style={styles.paymentCardEmoji}>💳</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.paymentCardTitle}>Delivery Complete — Pay Now</Text>
                <Text style={styles.paymentCardAmount}>
                  ₹{Math.round((activeBooking.fare?.totalInPaise || 0) / 100)}
                </Text>
              </View>
            </View>

            {activeBooking.paymentStatus !== 'customer_paid' && activeBooking.paymentStatus !== 'driver_confirmed' && (
              <TouchableOpacity
                style={styles.payUpiBtn}
                onPress={async () => {
                  const driverUpi = activeBooking.driverUpiId;
                  if (!driverUpi) {
                    Alert.alert('UPI not available', 'Driver has not set up their UPI ID. Please pay in cash.');
                    return;
                  }
                  const amount = Math.round((activeBooking.fare?.totalInPaise || 0) / 100);
                  const driverName = encodeURIComponent(activeBooking.driverName || 'Driver');
                  const note = encodeURIComponent(`Sarthi-${activeBooking.id.slice(0, 8)}`);
                  const upiUrl = `upi://pay?pa=${driverUpi}&pn=${driverName}&am=${amount}&cu=INR&tn=${note}`;
                  try {
                    const supported = await Linking.canOpenURL(upiUrl);
                    if (!supported) {
                      Alert.alert('No UPI App', `No UPI app found. Pay manually to ${driverUpi}, amount ₹${amount}`);
                      return;
                    }
                    await Linking.openURL(upiUrl);
                    setTimeout(() => {
                      Alert.alert(
                        'Did you complete the payment?',
                        'Confirm only after payment is successful in your UPI app.',
                        [
                          { text: 'Not yet', style: 'cancel' },
                          {
                            text: 'Yes, I paid',
                            onPress: async () => {
                              try {
                                await updateDoc(doc(db, 'bookings', activeBooking.id), {
                                  paymentStatus: 'customer_paid',
                                  customerPaidAt: new Date().toISOString(),
                                });
                              } catch (e) {
                                Alert.alert('Error', e.message);
                              }
                            },
                          },
                        ]
                      );
                    }, 800);
                  } catch (e) {
                    Alert.alert('Error', e.message);
                  }
                }}
              >
                <Ionicons name="card-outline" size={18} color="#FFF" />
                <Text style={styles.payUpiBtnText}>Pay ₹{Math.round((activeBooking.fare?.totalInPaise || 0) / 100)} via UPI</Text>
              </TouchableOpacity>
            )}

            {activeBooking.paymentStatus === 'customer_paid' && (
              <View style={styles.paidConfirmPill}>
                <Ionicons name="time-outline" size={16} color="#92400E" />
                <Text style={styles.paidConfirmText}>You marked as paid — waiting for driver to confirm</Text>
              </View>
            )}

            {activeBooking.paymentStatus === 'driver_confirmed' && (
              <View style={[styles.paidConfirmPill, { backgroundColor: '#ECFDF5', borderColor: '#A7F3D0' }]}>
                <Ionicons name="checkmark-circle" size={16} color="#065F46" />
                <Text style={[styles.paidConfirmText, { color: '#065F46' }]}>Payment confirmed!</Text>
              </View>
            )}
          </View>
        ) : (
          <View style={styles.otpCard}>
            <View style={styles.otpBlock}>
              <Text style={styles.otpLabel}>Pickup OTP</Text>
              <Text style={[styles.otpValue, isPostPickup && { color: '#10B981' }]}>
                {isPostPickup ? '✓' : activeBooking.pickupOtp}
              </Text>
            </View>
            <View style={styles.otpDivider} />
            <View style={styles.otpBlock}>
              <Text style={styles.otpLabel}>Dropoff OTP</Text>
              {isAtDropoff ? (
                <Text style={styles.otpValue}>{activeBooking.deliveryOtp}</Text>
              ) : (
                <Text style={styles.otpMasked}>Wait for arrival</Text>
              )}
            </View>
          </View>
        )}

        {/* Driver details — shown after acceptance, hidden once trip ends */}
        {activeBooking.driverName &&
          !['searching', 'completed', 'cancelled', 'cancelled_by_customer'].includes(activeBooking.status) && (
          <View style={styles.driverCard}>
            <View style={styles.driverAvatar}>
              <Ionicons name="person" size={22} color="#92400E" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.driverCardLabel}>YOUR DRIVER</Text>
              <Text style={styles.driverCardName}>{activeBooking.driverName}</Text>
              {activeBooking.driverVehicleLabel || activeBooking.driverVehicleNumber ? (
                <Text style={styles.driverCardVehicle} numberOfLines={1}>
                  {[activeBooking.driverVehicleLabel, activeBooking.driverVehicleNumber].filter(Boolean).join(' • ')}
                </Text>
              ) : null}
            </View>
            {activeBooking.driverPhone ? (
              <TouchableOpacity
                style={styles.driverCallBtn}
                onPress={() => Linking.openURL(`tel:${activeBooking.driverPhone}`)}
              >
                <Ionicons name="call" size={18} color="#FFFFFF" />
              </TouchableOpacity>
            ) : null}
          </View>
        )}

        {/* 👇 FIX: Cancel button disappears once status is 'picked_up' or higher */}
        {['searching', 'accepted', 'arrived'].includes(activeBooking.status) && (
          <TouchableOpacity style={styles.cancelBtn} onPress={cancelBooking} disabled={actionLoading}>
            {actionLoading ? <ActivityIndicator color="#EF4444" /> : <Text style={styles.cancelBtnText}>Cancel Booking</Text>}
          </TouchableOpacity>
        )}
        </ScrollView>
      </View>
    );
  };

  return (
    <View style={styles.flex}>
      {/* 👇 FIX: Bruteforce Map Dimensions to prevent disappearing blank screens */}
      <MapView
        ref={mapRef}
        style={{ width: width, height: height, position: 'absolute', top: 0, left: 0, zIndex: -1 }}
        mapType="standard"
        showsUserLocation={true}
        showsMyLocationButton={false}
        initialRegion={mapRegion}
        onRegionChangeComplete={(region, details) => {
          regionRef.current = region;
          if (bookingPhase === 'pickup' || bookingPhase === 'drop') {
            if (details?.isGesture) handleMapDragEnd(region);
            else setMapMarker({ latitude: region.latitude, longitude: region.longitude });
          }
        }}
      >
        {(bookingPhase === 'drop' || bookingPhase === 'fare' || bookingPhase === 'active') && pickupLocation && (
          <Marker coordinate={{ latitude: pickupLocation.lat, longitude: pickupLocation.lng }}>
            <View style={[styles.markerPin, { backgroundColor: '#10B981' }]}><Ionicons name="location" size={16} color="#FFF" /></View>
          </Marker>
        )}
        {(bookingPhase === 'fare' || bookingPhase === 'active') && dropLocation && (
          <Marker coordinate={{ latitude: dropLocation.lat, longitude: dropLocation.lng }}>
            <View style={[styles.markerPin, { backgroundColor: '#EF4444' }]}><Ionicons name="flag" size={16} color="#FFF" /></View>
          </Marker>
        )}
      </MapView>

      {(bookingPhase === 'pickup' || bookingPhase === 'drop') && (
        <View pointerEvents="none" style={styles.centerPinContainer}>
          <View style={[styles.centerBalloon, { backgroundColor: bookingPhase === 'pickup' ? '#10B981' : '#EF4444' }]}>
            <Ionicons name={bookingPhase === 'pickup' ? 'location' : 'flag'} size={24} color="#FFF" />
          </View>
          <View style={[styles.centerTail, { borderTopColor: bookingPhase === 'pickup' ? '#10B981' : '#EF4444' }]} />
          <View style={styles.centerShadow} />
        </View>
      )}

      {(bookingPhase === 'pickup' || bookingPhase === 'drop') && (
        <SafeAreaView style={styles.topMenuContainer}>
           <View style={styles.serviceToggleContainer}>
            {SERVICES.map(item => {
              const isActive = serviceType === item.id;
              return (
                <TouchableOpacity key={item.id} style={[styles.servicePill, isActive && styles.servicePillActive]} onPress={() => { setServiceType(item.id); resetToHome(); }}>
                  <Text style={[styles.servicePillText, isActive && styles.servicePillTextActive]}>{item.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {bookingPhase === 'pickup' && vehicleOptions.length > 0 && (
            <View style={styles.compactPreviewPanel}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.compactPreviewScroll}>
                {vehicleOptions.map((v, index) => (
                  <View key={index} style={styles.compactPreviewItem}>
                    <Ionicons name={vehicleIconName(v.id)} size={22} color="#4B5563" />
                    <Text style={styles.compactPreviewText}>{v.label}</Text>
                  </View>
                ))}
              </ScrollView>
            </View>
          )}
        </SafeAreaView>
      )}

      <KeyboardAvoidingView style={styles.bottomSheetWrapper} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {bookingPhase === 'pickup' || bookingPhase === 'drop' ? renderSearchPhase() : null}
        {bookingPhase === 'fare' ? renderFarePhase() : null}
        {bookingPhase === 'active' ? renderActiveBooking() : null}
      </KeyboardAvoidingView>

      {/* SOS Button - Top Right, Active Booking Only */}
      {currentBookingId && activeBooking && bookingPhase === 'active' && (
        <View style={{ position: 'absolute', top: 80, right: 20, zIndex: 100 }}>
          <SOSButton booking={activeBooking} position={mapMarker} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#F3F4F6' },
  topMenuContainer: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 16, paddingTop: Platform.OS === 'android' ? 40 : 16 },
  serviceToggleContainer: { flexDirection: 'row', backgroundColor: '#FFFFFF', borderRadius: 16, padding: 4, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 12, elevation: 5 },
  servicePill: { flex: 1, height: 46, borderRadius: 12, alignItems: 'center', justifyContent: 'center', flexDirection: 'row' },
  servicePillActive: { backgroundColor: '#111827' },
  servicePillText: { fontSize: 14, fontWeight: '700', color: '#6B7280' },
  servicePillTextActive: { color: '#FFFFFF' },
  compactPreviewPanel: { backgroundColor: '#FFFFFF', borderRadius: 12, marginTop: 8, paddingVertical: 10, paddingHorizontal: 12, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8, elevation: 4, alignSelf: 'center', width: '100%' },
  compactPreviewScroll: { gap: 18, alignItems: 'center' },
  compactPreviewItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  compactPreviewText: { fontSize: 13, fontWeight: '700', color: '#4B5563' },
  centerPinContainer: { position: 'absolute', top: '50%', left: '50%', marginLeft: -24, marginTop: -48, alignItems: 'center' },
  centerBalloon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 6, elevation: 6 },
  centerTail: { width: 0, height: 0, borderLeftWidth: 8, borderRightWidth: 8, borderTopWidth: 12, borderLeftColor: 'transparent', borderRightColor: 'transparent', marginTop: -2 },
  centerShadow: { width: 14, height: 6, borderRadius: 7, backgroundColor: '#000', opacity: 0.15, marginTop: 4, transform: [{ scaleX: 2.5 }] },
  locateBtn: { position: 'absolute', right: 16, top: -60, width: 46, height: 46, borderRadius: 23, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 10, zIndex: 100 },
  markerPin: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', borderWidth: 2.5, borderColor: '#FFF', shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 4, elevation: 4 },
  bottomSheetWrapper: { position: 'absolute', bottom: 0, left: 0, right: 0 },
  bottomSheet: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 16, paddingTop: 14, paddingBottom: Platform.OS === 'ios' ? 24 : 14, maxHeight: height * 0.55, shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.06, shadowRadius: 12, elevation: 16 },
  fareSheetContainer: { height: height * 0.65, backgroundColor: '#FFFFFF', borderTopLeftRadius: 28, borderTopRightRadius: 28, shadowColor: '#000', shadowOffset: { width: 0, height: -6 }, shadowOpacity: 0.08, shadowRadius: 16, elevation: 20 },
  sheetHeaderFixed: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 20, marginBottom: 16 },
  sheetTitleFixed: { fontSize: 22, fontWeight: '800', color: '#111827' },
  scrollableMiddle: { flex: 1, paddingHorizontal: 20 },
  pinnedBottom: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: Platform.OS === 'ios' ? 34 : 20, borderTopWidth: 1, borderTopColor: '#F3F4F6', backgroundColor: '#FFFFFF' },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  backBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  sheetTitle: { fontSize: 18, fontWeight: '800', color: '#111827' },
  sheetTitleSmall: { fontSize: 16, fontWeight: '800', color: '#111827', marginBottom: 12, marginTop: 8 },
  routeSummaryBox: { backgroundColor: '#F9FAFB', borderRadius: 16, padding: 16, marginBottom: 18, borderWidth: 1, borderColor: '#F3F4F6' },
  routeSummaryRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  greenDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#10B981', marginTop: 5 },
  redSquare: { width: 10, height: 10, borderRadius: 3, backgroundColor: '#EF4444', marginTop: 5 },
  routeSummaryText: { flex: 1, fontSize: 14, color: '#374151', fontWeight: '600' },
  routeSummaryDivider: { height: 16, width: 2, backgroundColor: '#E5E7EB', marginLeft: 4, marginVertical: 4 },
  searchBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F9FAFB', borderRadius: 12, paddingHorizontal: 14, height: 46, marginBottom: 10, borderWidth: 1, borderColor: '#F3F4F6' },
  searchInputArea: { flex: 1, marginLeft: 12, fontSize: 16, color: '#111827', fontWeight: '500' },
  searchResultsList: { maxHeight: 200 },
  searchResultRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  resultIconBg: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center' },
  resultTextBlock: { marginLeft: 14, flex: 1 },
  resMain: { fontSize: 15, fontWeight: '700', color: '#111827', marginBottom: 2 },
  resSub: { fontSize: 13, color: '#6B7280' },
  manualAddressWrapper: { marginBottom: 16 },
  manualInput: { backgroundColor: '#F9FAFB', borderWidth: 1, borderColor: '#F3F4F6', borderRadius: 16, padding: 16, fontSize: 15, color: '#111827' },
  emptyVehicles: { height: 120, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F9FAFB', borderRadius: 16, marginBottom: 16 },
  emptyVehiclesText: { color: '#6B7280', marginTop: 8, fontWeight: '600' },
  horizontalVehicleScroll: { paddingBottom: 12, gap: 8, paddingRight: 16, paddingTop: 4 },
  vehicleCardHorizontal: { width: 60, paddingVertical: 10, paddingHorizontal: 4, backgroundColor: '#FFFFFF', borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: '#F3F4F6' },
  vehicleCardActive: { borderColor: '#111827', backgroundColor: '#F9FAFB' },
  vehicleIconCircle: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  vehicleIconCircleActive: { backgroundColor: '#E5E7EB' },
  vName: { fontSize: 11, fontWeight: '700', color: '#4B5563', textAlign: 'center' },
  vNameActive: { color: '#111827' },
  vCap: { display: 'none' },
  vPrice: { fontSize: 11, fontWeight: '800', color: '#6B7280', marginTop: 2 },
  vPriceActive: { color: '#10B981' },
  packageInput: { backgroundColor: '#F9FAFB', borderWidth: 1, borderColor: '#F3F4F6', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 13, color: '#111827', marginBottom: 12 },

  // Vertical list rows
  vehicleList: { gap: 6, marginBottom: 12 },
  vehicleListRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#F3F4F6', borderRadius: 12 },
  vehicleListRowActive: { borderColor: '#111827', backgroundColor: '#F9FAFB' },
  vehicleListIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center' },
  vehicleListIconActive: { backgroundColor: '#E5E7EB' },
  vehicleListName: { fontSize: 13, fontWeight: '700', color: '#374151' },
  vehicleListNameActive: { color: '#111827' },
  vehicleListCap: { fontSize: 11, color: '#9CA3AF', fontWeight: '500', marginTop: 1 },
  vehicleListPrice: { fontSize: 13, fontWeight: '800', color: '#6B7280' },
  vehicleListPriceActive: { color: '#10B981' },
  receiptBox: { backgroundColor: '#F9FAFB', borderRadius: 16, padding: 18, marginBottom: 16 },
  receiptRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
  receiptLabel: { fontSize: 14, color: '#6B7280', fontWeight: '500' },
  receiptValue: { fontSize: 15, color: '#374151', fontWeight: '700' },
  receiptDivider: { height: 1, backgroundColor: '#E5E7EB', marginVertical: 8 },
  receiptTotalLabel: { fontSize: 15, fontWeight: '700', color: '#6B7280' },
  receiptTotalValue: { fontSize: 26, fontWeight: '900', color: '#111827' },
  fareRangeNote: { fontSize: 11, color: '#6B7280', fontWeight: '500', marginTop: 6, fontStyle: 'italic' },
  activeHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  statusHeaderExpanded: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#F9FAFB', padding: 16, borderRadius: 16, marginRight: 12, borderWidth: 1, borderColor: '#F3F4F6' },
  statusText: { fontSize: 15, fontWeight: '800', color: '#10B981', flexShrink: 1 },
  minimizeBtn: { width: 48, height: 48, backgroundColor: '#F9FAFB', borderRadius: 24, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#F3F4F6' },
  otpCard: { flexDirection: 'row', backgroundColor: '#FFFFFF', borderRadius: 16, padding: 20, marginBottom: 24, borderWidth: 1, borderColor: '#F3F4F6', shadowColor: '#000', shadowOpacity: 0.03, shadowRadius: 8, elevation: 2 },
  paymentCard: { backgroundColor: '#FEF3C7', borderRadius: 16, padding: 18, marginBottom: 16, borderWidth: 1.5, borderColor: '#FDE68A' },
  paymentCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
  paymentCardEmoji: { fontSize: 28 },
  paymentCardTitle: { fontSize: 14, fontWeight: '800', color: '#92400E', letterSpacing: 0.2 },
  paymentCardAmount: { fontSize: 28, fontWeight: '900', color: '#78350F', marginTop: 2, letterSpacing: -1 },
  payUpiBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#10B981', borderRadius: 12, paddingVertical: 14, marginTop: 4 },
  payUpiBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800', letterSpacing: 0.3 },
  paidConfirmPill: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#FEF3C7', borderRadius: 10, padding: 12, marginTop: 10, borderWidth: 1, borderColor: '#FDE68A' },
  paidConfirmText: { fontSize: 12, fontWeight: '700', color: '#92400E', flex: 1 },
  otpBlock: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  otpLabel: { fontSize: 12, color: '#9CA3AF', fontWeight: '700', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  otpValue: { fontSize: 26, color: '#111827', fontWeight: '900', letterSpacing: 3 },
  otpMasked: { fontSize: 14, color: '#9CA3AF', fontWeight: '700', marginTop: 4 },
  otpDivider: { width: 1, backgroundColor: '#F3F4F6', marginHorizontal: 16 },
  minimizedSheet: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 20, paddingBottom: Platform.OS === 'ios' ? 34 : 20, shadowColor: '#000', shadowOffset: { width: 0, height: -6 }, shadowOpacity: 0.08, shadowRadius: 16, elevation: 20 },
  minimizedRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  minimizedLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#F9FAFB', paddingHorizontal: 16, paddingVertical: 14, borderRadius: 16, flex: 1, marginRight: 12, borderWidth: 1, borderColor: '#F3F4F6' },
  actionButton: { height: 46, backgroundColor: '#10B981', borderRadius: 12, alignItems: 'center', justifyContent: 'center', shadowColor: '#10B981', shadowOpacity: 0.2, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 4 },
  payChipsRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  payChip: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, paddingHorizontal: 12, backgroundColor: '#F9FAFB', borderRadius: 10, borderWidth: 1.5, borderColor: '#F3F4F6' },
  payChipActive: { borderColor: '#111827', backgroundColor: '#FFFFFF' },
  payChipEmoji: { fontSize: 14 },
  payChipText: { fontSize: 13, fontWeight: '700', color: '#6B7280' },
  payChipTextActive: { color: '#111827' },
  confirmLocBtn: { height: 44, backgroundColor: '#111827', borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  confirmLocText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800', letterSpacing: 0.2 },
  disabledBtn: { backgroundColor: '#D1D5DB', shadowOpacity: 0 },
  actionButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800', letterSpacing: 0.3 },
  cancelBtn: { height: 52, backgroundColor: '#FFFFFF', borderWidth: 1.5, borderColor: '#FEE2E2', borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  driverCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, backgroundColor: '#FEF3C7', borderRadius: 16, marginBottom: 12 },
  driverAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#FDE68A', alignItems: 'center', justifyContent: 'center' },
  driverCardLabel: { fontSize: 10, fontWeight: '800', color: '#92400E', letterSpacing: 0.5 },
  driverCardName: { fontSize: 15, fontWeight: '700', color: '#111827', marginTop: 2 },
  driverCardVehicle: { fontSize: 12, color: '#6B7280', marginTop: 2, fontWeight: '500' },
  driverCallBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#10B981', alignItems: 'center', justifyContent: 'center' },
  cancelBtnText: { color: '#EF4444', fontSize: 16, fontWeight: '800' },
});