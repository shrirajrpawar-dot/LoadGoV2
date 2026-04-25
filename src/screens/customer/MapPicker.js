import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Alert,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';

export default function MapPicker() {
  const navigation = useNavigation();
  const route = useRoute();

  const { locationType, initialLocation } = route.params || {};

  const [address, setAddress] = useState(initialLocation?.address || '');
  const [lat, setLat] = useState(
    initialLocation?.lat !== undefined ? String(initialLocation.lat) : ''
  );
  const [lng, setLng] = useState(
    initialLocation?.lng !== undefined ? String(initialLocation.lng) : ''
  );

  const handleSave = () => {
    if (!address.trim()) {
      Alert.alert('Required', 'Please enter address');
      return;
    }

    if (lat.trim() === '' || lng.trim() === '') {
      Alert.alert('Required', 'Please enter latitude and longitude');
      return;
    }

    const parsedLat = Number(lat);
    const parsedLng = Number(lng);

    if (Number.isNaN(parsedLat) || Number.isNaN(parsedLng)) {
      Alert.alert('Invalid', 'Latitude and longitude must be valid numbers');
      return;
    }

    navigation.navigate({
      name: 'CustomerHome',
      params: {
        selectedLocation: {
          address: address.trim(),
          lat: parsedLat,
          lng: parsedLng,
        },
        locationType,
      },
      merge: true,
    });
  };

  return (
    <SafeAreaView style={s.container}>
      <ScrollView contentContainerStyle={s.content}>
        <Text style={s.title}>
          {locationType === 'drop' ? 'Select Drop Location' : 'Select Pickup Location'}
        </Text>

        <Text style={s.label}>Address</Text>
        <TextInput
          style={s.input}
          placeholder="Enter full address"
          value={address}
          onChangeText={setAddress}
          placeholderTextColor="#9CA3AF"
          multiline
        />

        <Text style={s.label}>Latitude</Text>
        <TextInput
          style={s.input}
          placeholder="e.g. 19.0760"
          value={lat}
          onChangeText={setLat}
          keyboardType="numeric"
          placeholderTextColor="#9CA3AF"
        />

        <Text style={s.label}>Longitude</Text>
        <TextInput
          style={s.input}
          placeholder="e.g. 72.8777"
          value={lng}
          onChangeText={setLng}
          keyboardType="numeric"
          placeholderTextColor="#9CA3AF"
        />

        <TouchableOpacity style={s.saveBtn} onPress={handleSave}>
          <Text style={s.saveBtnText}>Save Location</Text>
        </TouchableOpacity>

        <TouchableOpacity style={s.cancelBtn} onPress={() => navigation.goBack()}>
          <Text style={s.cancelBtnText}>Cancel</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  content: {
    padding: 20,
    paddingBottom: 40,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 20,
  },
  label: {
    fontSize: 13,
    fontWeight: '700',
    color: '#6B7280',
    marginBottom: 8,
    marginTop: 14,
  },
  input: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    padding: 14,
    fontSize: 14,
    color: '#111827',
    minHeight: 52,
    textAlignVertical: 'top',
  },
  saveBtn: {
    backgroundColor: '#10B981',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 24,
  },
  saveBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  cancelBtn: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 12,
  },
  cancelBtnText: {
    color: '#374151',
    fontSize: 16,
    fontWeight: '700',
  },
});