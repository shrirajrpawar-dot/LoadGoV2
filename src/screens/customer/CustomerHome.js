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
} from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { addDoc, collection, serverTimestamp, doc, onSnapshot, updateDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions, auth } from '../../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { useAppSettings } from '../../hooks/useAppSettings';

const { width, height } = Dimensions.get('window');
const GOOGLE_API_KEY = 'AIzaSyDqEdCuxppmgcSK0i9SbEWjw9tnsn9YnCI';

const DEFAULT_REGION = { latitude: 19.076, longitude: 72.8777, latitudeDelta: 0.055, longitudeDelta: 0.055 };
const SERVICES = [
  { id: 'parcel', label: 'Send Package', fallbackIcon: 'cube' },
  { id: 'ride', label: 'Book a Ride', fallbackIcon: 'car' },
];

const quoteFare = httpsCallable(functions, 'quoteFare');
const generateOtp = () => Math.floor(1000 + Math.random() * 9000).toString();
const generateSessionToken = () => Math.random().toString(36).substring(2) + Date.now().toString(36);

// Smarter Icon Mapping based on your exact backend config
const vehicleIconName = (vehicleId = '') => {
  const id = vehicleId.toLowerCase();
  if (id.includes('bike') || id.includes('scooty')) return 'bicycle';
  if (id.includes('tempo') || id.includes('hatti')) return 'bus';
  if (id.includes('3wheeler') || id.includes('auto')) return 'car-sport';
  if (id.includes('7') || id.includes('seater') || id.includes('suv')) return 'people';
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

  const getServiceIcons = (svcId) => {
    const source = svcId === 'parcel' ? settings.parcelVehicles : settings.rideVehicles;
    const opts = (source || []).filter(v => v.enabled !== false);
    const icons = Array.from(new Set(opts.map(v => vehicleIconName(v.id))));
    return icons.length > 0 ? icons : [SERVICES.find(s => s.id === svcId).fallbackIcon];
  };

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
          Alert.alert("Fare Error", error.message);
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
        commission: { amountInPaise: quoteCommission.amountInPaise || 0, pct: quoteCommission.pct || 0, status: paymentMethod === 'upi' ? 'collected' : 'pending_from_driver' },
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

  // --- RENDER HELPERS ---

  const renderSearchPhase = () => (
    <View style={styles.bottomSheet}>
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
              <Ionicons name="location-outline" size={20} color="#6B7280" />
              <View style={styles.resultTextBlock}>
                <Text style={styles.resMain} numberOfLines={1}>{item.main_text}</Text>
                <Text style={styles.resSub} numberOfLines={1}>{item.secondary_text}</Text>
              </View>
            </TouchableOpacity>
          )}
        />
      ) : (
        <View style={styles.manualAddressWrapper}>
          <TextInput
            style={styles.manualInput}
            value={manualAddress}
            onChangeText={setManualAddress}
            placeholder="House/Flat No., Building Name (Optional)"
            placeholderTextColor="#9CA3AF"
          />
        </View>
      )}

      <TouchableOpacity style={styles.actionButton} onPress={confirmLocation} disabled={mapLoading}>
        {mapLoading ? <ActivityIndicator color="#FFF" /> : <Text style={styles.actionButtonText}>Confirm {bookingPhase === 'pickup' ? 'Pickup' : 'Dropoff'}</Text>}
      </TouchableOpacity>
    </View>
  );

  // REDESIGNED VERTICAL LIST FARE UI
  const renderFarePhase = () => (
    <View style={styles.fareSheetContainer}>
      {/* Fixed Header */}
      <View style={styles.sheetHeader}>
        <TouchableOpacity style={styles.backBtn} onPress={goBack}>
          <Ionicons name="arrow-back" size={24} color="#111827" />
        </TouchableOpacity>
        <Text style={styles.sheetTitle}>Confirm Booking</Text>
      </View>

      {/* Scrollable List of Vehicles */}
      <ScrollView 
        style={styles.scrollableVehicleList} 
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 20 }}
      >
        <View style={styles.routeSummaryBox}>
          <View style={styles.routeSummaryRow}>
            <View style={styles.greenDot} />
            <Text style={styles.routeSummaryText} numberOfLines={1}>{pickupLocation?.address}</Text>
          </View>
          <View style={styles.routeSummaryDivider} />
          <View style={styles.routeSummaryRow}>
            <View style={styles.redSquare} />
            <Text style={styles.routeSummaryText} numberOfLines={1}>{dropLocation?.address}</Text>
          </View>
        </View>

        {vehicleOptions.length === 0 ? (
          <View style={styles.emptyVehicles}><ActivityIndicator color="#111827" /><Text style={styles.emptyVehiclesText}>Loading vehicles...</Text></View>
        ) : (
          <View style={styles.vehicleListContainer}>
            {vehicleOptions.map(v => {
              const active = selectedVehicle === v.id;
              return (
                <TouchableOpacity 
                  key={v.id} 
                  style={[styles.vehicleRow, active && styles.vehicleRowActive]} 
                  onPress={() => setSelectedVehicle(v.id)}
                  activeOpacity={0.7}
                >
                  <View style={styles.vehicleIconCircle}>
                    <Ionicons name={vehicleIconName(v.id)} size={28} color={active ? '#111827' : '#6B7280'} />
                  </View>
                  <View style={styles.vehicleDetails}>
                    <Text style={styles.vehicleName}>{v.label}</Text>
                    {/* Properly showing the capacity description here */}
                    <Text style={styles.vehicleCapacity}>{v.capacity || 'Standard Capacity'}</Text>
                  </View>
                  <View style={styles.vehiclePriceBox}>
                    <Text style={styles.vehiclePrice}>₹{v.baseFare}+</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {serviceType === 'parcel' && (
          <TextInput style={styles.packageInput} value={itemsDescription} onChangeText={setItemsDescription} placeholder="E.g. Documents, Clothes..." placeholderTextColor="#9CA3AF" />
        )}
      </ScrollView>

      {/* Fixed Bottom Action Area */}
      <View style={styles.fareFooter}>
        <View style={styles.fareFooterDetails}>
          <Text style={styles.totalFareLabel}>Total Fare {fareQuote?.distanceKm ? `(${fareQuote.distanceKm} km)` : ''}</Text>
          {quoteLoading ? <ActivityIndicator size="small" color="#111827" /> : <Text style={styles.totalFareValue}>₹{totalFare}</Text>}
        </View>
        <TouchableOpacity style={[styles.actionButton, actionLoading && styles.disabledBtn]} onPress={handleCreateBooking} disabled={actionLoading || quoteLoading || vehicleOptions.length === 0}>
          {actionLoading ? <ActivityIndicator color="#FFF" /> : <Text style={styles.actionButtonText}>Confirm & Book</Text>}
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderActiveBooking = () => {
    if (!activeBooking) return null;

    const isPostPickup = ['picked_up', 'reached', 'reached_dropoff', 'completed'].includes(activeBooking.status);
    const isAtDropoff = ['reached', 'reached_dropoff', 'completed'].includes(activeBooking.status);

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

        <TouchableOpacity style={styles.cancelBtn} onPress={cancelBooking} disabled={actionLoading}>
          {actionLoading ? <ActivityIndicator color="#EF4444" /> : <Text style={styles.cancelBtnText}>Cancel Booking</Text>}
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <View style={styles.flex}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFillObject}
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
              const icons = getServiceIcons(item.id);
              return (
                <TouchableOpacity key={item.id} style={[styles.servicePill, isActive && styles.servicePillActive]} onPress={() => { setServiceType(item.id); resetToHome(); }}>
                  <View style={styles.pillIconRow}>
                    {icons.map((ic, idx) => (
                      <Ionicons key={idx} name={ic} size={14} color={isActive ? '#FFF' : '#4B5563'} />
                    ))}
                  </View>
                  <Text style={[styles.servicePillText, isActive && styles.servicePillTextActive]}>{item.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </SafeAreaView>
      )}

      <KeyboardAvoidingView style={styles.bottomSheetWrapper} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {bookingPhase === 'pickup' || bookingPhase === 'drop' ? renderSearchPhase() : null}
        {bookingPhase === 'fare' ? renderFarePhase() : null}
        {bookingPhase === 'active' ? renderActiveBooking() : null}
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#F4F5F9' },
  topMenuContainer: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 20, paddingTop: Platform.OS === 'android' ? 40 : 10 },
  
  serviceToggleContainer: { flexDirection: 'row', backgroundColor: '#FFF', borderRadius: 100, padding: 4, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 10, elevation: 5 },
  servicePill: { flex: 1, height: 48, borderRadius: 100, alignItems: 'center', justifyContent: 'center', flexDirection: 'row' },
  servicePillActive: { backgroundColor: '#111827' },
  servicePillText: { fontSize: 14, fontWeight: '700', color: '#4B5563' },
  servicePillTextActive: { color: '#FFF' },
  pillIconRow: { flexDirection: 'row', gap: 4, marginRight: 8 }, 

  // Map Pins
  centerPinContainer: { position: 'absolute', top: '50%', left: '50%', marginLeft: -24, marginTop: -48, alignItems: 'center' },
  centerBalloon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 5, elevation: 5 },
  centerTail: { width: 0, height: 0, borderLeftWidth: 8, borderRightWidth: 8, borderTopWidth: 12, borderLeftColor: 'transparent', borderRightColor: 'transparent', marginTop: -2 },
  centerShadow: { width: 16, height: 8, borderRadius: 8, backgroundColor: '#000', opacity: 0.15, marginTop: 2, transform: [{ scaleX: 2 }] },
  markerPin: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#FFF', shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 4, elevation: 4 },

  // Bottom Sheet Standard Wrapper
  bottomSheetWrapper: { position: 'absolute', bottom: 0, left: 0, right: 0 },
  bottomSheet: { backgroundColor: '#FFF', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: Platform.OS === 'ios' ? 34 : 20, shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.1, shadowRadius: 10, elevation: 15 },
  
  // NEW: Fare Sheet Container (Takes up exactly 55% of screen to allow scrolling)
  fareSheetContainer: { height: height * 0.55, backgroundColor: '#FFF', borderTopLeftRadius: 24, borderTopRightRadius: 24, shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.1, shadowRadius: 10, elevation: 15 },
  scrollableVehicleList: { flex: 1, paddingHorizontal: 20 },
  fareFooter: { padding: 20, paddingBottom: Platform.OS === 'ios' ? 34 : 20, backgroundColor: '#FFF', borderTopWidth: 1, borderTopColor: '#F3F4F6' },
  fareFooterDetails: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },

  sheetHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 16, paddingHorizontal: 20, paddingTop: 20 },
  backBtn: { width: 40, height: 40, alignItems: 'flex-start', justifyContent: 'center', marginRight: 4 },
  sheetTitle: { fontSize: 22, fontWeight: '800', color: '#111827' },
  sheetTitleSmall: { fontSize: 18, fontWeight: '800', color: '#111827', marginBottom: 12, marginTop: 8 },

  // Route Summary
  routeSummaryBox: { backgroundColor: '#F9FAFB', borderRadius: 16, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: '#E5E7EB' },
  routeSummaryRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  greenDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#10B981' },
  redSquare: { width: 10, height: 10, backgroundColor: '#EF4444' },
  routeSummaryText: { flex: 1, fontSize: 14, color: '#4B5563', fontWeight: '500' },
  routeSummaryDivider: { height: 16, width: 2, backgroundColor: '#E5E7EB', marginLeft: 4, marginVertical: 4 },

  // Search
  searchBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F3F4F6', borderRadius: 14, paddingHorizontal: 16, height: 54, marginBottom: 12 },
  searchInputArea: { flex: 1, marginLeft: 10, fontSize: 16, color: '#111827', fontWeight: '500' },
  searchResultsList: { maxHeight: 180 },
  searchResultRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  resultTextBlock: { marginLeft: 12, flex: 1 },
  resMain: { fontSize: 15, fontWeight: '600', color: '#111827' },
  resSub: { fontSize: 13, color: '#6B7280', marginTop: 2 },
  manualAddressWrapper: { marginBottom: 16 },
  manualInput: { backgroundColor: '#F9FAFB', borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 12, padding: 14, fontSize: 15, color: '#111827' },

  // NEW: Vertical Vehicle List UI
  emptyVehicles: { height: 120, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F9FAFB', borderRadius: 16, marginBottom: 16 },
  emptyVehiclesText: { color: '#6B7280', marginTop: 8, fontWeight: '500' },
  vehicleListContainer: { marginBottom: 12 },
  vehicleRow: { flexDirection: 'row', alignItems: 'center', padding: 16, backgroundColor: '#FFF', borderRadius: 16, marginBottom: 10, borderWidth: 2, borderColor: '#F3F4F6' },
  vehicleRowActive: { borderColor: '#111827', backgroundColor: '#F9FAFB' },
  vehicleIconCircle: { width: 50, height: 50, borderRadius: 25, backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center', marginRight: 14 },
  vehicleDetails: { flex: 1 },
  vehicleName: { fontSize: 16, fontWeight: '800', color: '#111827', marginBottom: 4 },
  vehicleCapacity: { fontSize: 13, color: '#6B7280', fontWeight: '500' },
  vehiclePriceBox: { alignItems: 'flex-end', justifyContent: 'center' },
  vehiclePrice: { fontSize: 18, fontWeight: '900', color: '#111827' },
  
  packageInput: { backgroundColor: '#F9FAFB', borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 12, padding: 14, fontSize: 15, color: '#111827', marginBottom: 16 },
  
  totalFareLabel: { fontSize: 16, fontWeight: '700', color: '#4B5563' },
  totalFareValue: { fontSize: 26, fontWeight: '900', color: '#111827' },

  // Active Booking
  activeHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  statusHeaderExpanded: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#ECFDF5', padding: 16, borderRadius: 12, marginRight: 12 },
  statusText: { fontSize: 15, fontWeight: '700', color: '#047857', flexShrink: 1 },
  minimizeBtn: { width: 44, height: 44, backgroundColor: '#F3F4F6', borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  
  otpCard: { flexDirection: 'row', backgroundColor: '#F9FAFB', borderRadius: 12, padding: 16, marginBottom: 20, borderWidth: 1, borderColor: '#E5E7EB' },
  otpBlock: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  otpLabel: { fontSize: 13, color: '#6B7280', fontWeight: '600', marginBottom: 4 },
  otpValue: { fontSize: 24, color: '#111827', fontWeight: '900', letterSpacing: 2 },
  otpMasked: { fontSize: 14, color: '#9CA3AF', fontWeight: '600', marginTop: 4 },
  otpDivider: { width: 1, backgroundColor: '#E5E7EB', marginHorizontal: 16 },

  minimizedSheet: { backgroundColor: '#FFF', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: Platform.OS === 'ios' ? 34 : 20, shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.1, shadowRadius: 10, elevation: 15 },
  minimizedRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  minimizedLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#ECFDF5', paddingHorizontal: 16, paddingVertical: 12, borderRadius: 12, flex: 1, marginRight: 12 },

  // Buttons
  actionButton: { height: 56, backgroundColor: '#111827', borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  disabledBtn: { backgroundColor: '#9CA3AF' },
  actionButtonText: { color: '#FFF', fontSize: 18, fontWeight: '800' },
  cancelBtn: { height: 50, backgroundColor: '#FFF', borderWidth: 2, borderColor: '#FEE2E2', borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  cancelBtnText: { color: '#EF4444', fontSize: 16, fontWeight: '700' },
});