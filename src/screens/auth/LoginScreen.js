import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  Alert, ActivityIndicator, KeyboardAvoidingView, Platform,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

export default function LoginScreen({ onLogin, onCheckPhone }) {
  // Steps: 'phone' → 'otp' → 'register' (only if new user)
  const [step, setStep] = useState('phone');
  const [phone, setPhone] = useState('');
  const [generatedOtp, setGeneratedOtp] = useState('');
  const [otpInput, setOtpInput] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const validatePhone = (p) => /^[0-9]{10}$/.test(p);
  const validateEmail = (e) => !e || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

  // STEP 1: Enter phone → send OTP
  const handleSendOtp = () => {
    setError('');
    if (!validatePhone(phone)) {
      setError('Please enter a valid 10-digit mobile number');
      return;
    }
    const otp = Math.floor(1000 + Math.random() * 9000).toString();
    setGeneratedOtp(otp);
    setStep('otp');
    console.log('Generated OTP:', otp);
  };

  // STEP 2: Verify OTP → check if user exists
  const handleVerifyOtp = async () => {
    setError('');
    if (otpInput.length !== 4) { setError('Enter 4-digit OTP'); return; }
    if (otpInput !== generatedOtp) {
      setError('Invalid OTP. Try again.');
      setOtpInput('');
      return;
    }

    setLoading(true);
    try {
      // Check if phone exists in Firestore
      const existing = await onCheckPhone(phone.trim());

      if (existing) {
        // Existing user → login directly with their data
        await onLogin(existing.name, existing.email || '', phone.trim(), existing);
      } else {
        // New user → show registration form
        setStep('register');
      }
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  // STEP 3: Register new user
  const handleRegister = async () => {
    setError('');
    if (!name.trim()) { setError('Please enter your name'); return; }
    if (!validateEmail(email)) { setError('Please enter a valid email'); return; }

    setLoading(true);
    try {
      await onLogin(name.trim(), email.trim(), phone.trim(), null);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  // ─── STEP 3: Registration Form (new users only) ───
  if (step === 'register') {
    return (
      <SafeAreaView style={s.container}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
            <TouchableOpacity style={s.backRow} onPress={() => setStep('otp')}>
              <Ionicons name="arrow-back" size={20} color="#111827" />
              <Text style={s.backText}>Back</Text>
            </TouchableOpacity>

            <View style={s.headerSection}>
              <View style={s.logoCircle}>
                <Ionicons name="person-add" size={32} color="#10B981" />
              </View>
              <Text style={s.title}>Complete Profile</Text>
              <Text style={s.subtitle}>Just a few details to get started</Text>
            </View>

            <View style={s.phoneConfirmed}>
              <Ionicons name="checkmark-circle" size={18} color="#059669" />
              <Text style={s.phoneConfirmedText}>+91 {phone} verified</Text>
            </View>

            <Text style={s.inputLabel}>Full Name</Text>
            <TextInput
              style={s.input}
              value={name}
              onChangeText={(t) => { setName(t); setError(''); }}
              placeholder="Enter your full name"
              placeholderTextColor="#9CA3AF"
              autoCapitalize="words"
              autoFocus
            />

            <Text style={s.inputLabel}>Email Address (Optional)</Text>
            <TextInput
              style={s.input}
              value={email}
              onChangeText={(t) => { setEmail(t.toLowerCase()); setError(''); }}
              placeholder="your@email.com"
              placeholderTextColor="#9CA3AF"
              keyboardType="email-address"
              autoCapitalize="none"
            />

            {error ? (
              <View style={s.errorRow}>
                <Ionicons name="alert-circle" size={14} color="#EF4444" />
                <Text style={s.errorText}>{error}</Text>
              </View>
            ) : null}

            <TouchableOpacity
              style={[s.primaryBtn, loading && s.btnDisabled]}
              onPress={handleRegister}
              disabled={loading}
            >
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={s.primaryBtnText}>Create Account</Text>}
            </TouchableOpacity>

            <Text style={s.terms}>By continuing, you agree to our Terms of Service and Privacy Policy</Text>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // ─── STEP 2: OTP Verification ───
  if (step === 'otp') {
    return (
      <SafeAreaView style={s.container}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
            <TouchableOpacity style={s.backRow} onPress={() => { setStep('phone'); setOtpInput(''); setError(''); }}>
              <Ionicons name="arrow-back" size={20} color="#111827" />
              <Text style={s.backText}>Back</Text>
            </TouchableOpacity>

            <View style={s.headerSection}>
              <View style={s.logoCircle}>
                <Ionicons name="shield-checkmark" size={32} color="#10B981" />
              </View>
              <Text style={s.title}>Verify OTP</Text>
              <Text style={s.subtitle}>OTP sent to +91 {phone}</Text>
            </View>

            <View style={s.testOtpBox}>
              <View style={s.testOtpHeader}>
                <Ionicons name="flask-outline" size={16} color="#92400E" />
                <Text style={s.testOtpLabel}>TEST MODE</Text>
              </View>
              <Text style={s.testOtpCode}>{generatedOtp}</Text>
              <Text style={s.testOtpHint}>In production, this will be sent via SMS</Text>
            </View>

            <Text style={s.inputLabel}>Enter 4-digit OTP</Text>
            <TextInput
              style={[s.otpInput, error && s.inputError]}
              value={otpInput}
              onChangeText={(t) => { setOtpInput(t.replace(/[^0-9]/g, '').slice(0, 4)); setError(''); }}
              placeholder="0 0 0 0"
              placeholderTextColor="#D1D5DB"
              keyboardType="numeric"
              maxLength={4}
              autoFocus
            />

            {error ? (
              <View style={s.errorRow}>
                <Ionicons name="alert-circle" size={14} color="#EF4444" />
                <Text style={s.errorText}>{error}</Text>
              </View>
            ) : null}

            <TouchableOpacity
              style={[s.primaryBtn, loading && s.btnDisabled]}
              onPress={handleVerifyOtp}
              disabled={loading}
            >
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={s.primaryBtnText}>Verify & Continue</Text>}
            </TouchableOpacity>

            <TouchableOpacity onPress={handleSendOtp} style={s.resendRow}>
              <Text style={s.resendText}>Didn't get OTP? Resend</Text>
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // ─── STEP 1: Phone Number Entry ───
  return (
    <SafeAreaView style={s.container}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
          <View style={s.headerSection}>
            <View style={s.logoCircle}>
              <Ionicons name="cube" size={36} color="#10B981" />
            </View>
            <Text style={s.appName}>Sarthi</Text>
            <Text style={s.tagline}>Fast Delivery, Anywhere</Text>
          </View>

          <View style={s.formSection}>
            <Text style={s.formTitle}>Login / Sign Up</Text>
            <Text style={s.formSub}>Enter your mobile number to continue</Text>

            <Text style={s.inputLabel}>Mobile Number</Text>
            <View style={s.phoneRow}>
              <View style={s.countryCode}>
                <Text style={s.countryCodeText}>+91</Text>
              </View>
              <TextInput
                style={s.phoneInput}
                value={phone}
                onChangeText={(t) => { setPhone(t.replace(/[^0-9]/g, '').slice(0, 10)); setError(''); }}
                placeholder="10-digit number"
                placeholderTextColor="#9CA3AF"
                keyboardType="numeric"
                maxLength={10}
                autoFocus
              />
            </View>

            {error ? (
              <View style={s.errorRow}>
                <Ionicons name="alert-circle" size={14} color="#EF4444" />
                <Text style={s.errorText}>{error}</Text>
              </View>
            ) : null}

            <TouchableOpacity style={s.primaryBtn} onPress={handleSendOtp}>
              <Text style={s.primaryBtnText}>Send OTP</Text>
            </TouchableOpacity>

            <View style={s.infoBox}>
              <Ionicons name="information-circle-outline" size={16} color="#6B7280" />
              <Text style={s.infoText}>
                Existing users will be logged in automatically. New users will complete a quick registration.
              </Text>
            </View>

            <Text style={s.terms}>By continuing, you agree to our Terms of Service and Privacy Policy</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  scroll: { padding: 24, paddingBottom: 40 },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 },
  backText: { fontSize: 15, fontWeight: '700', color: '#111827' },
  headerSection: { alignItems: 'center', marginBottom: 36, marginTop: 16 },
  logoCircle: { width: 84, height: 84, borderRadius: 42, backgroundColor: '#ECFDF5', alignItems: 'center', justifyContent: 'center', marginBottom: 18, borderWidth: 1, borderColor: '#A7F3D0' },
  appName: { fontSize: 32, fontWeight: '900', color: '#111827', letterSpacing: -0.5 },
  tagline: { fontSize: 15, color: '#6B7280', fontWeight: '600', marginTop: 6 },
  title: { fontSize: 26, fontWeight: '800', color: '#111827' },
  subtitle: { fontSize: 14, color: '#6B7280', fontWeight: '500', marginTop: 6 },
  formSection: { flex: 1 },
  formTitle: { fontSize: 20, fontWeight: '800', color: '#111827', marginBottom: 4 },
  formSub: { fontSize: 13, color: '#6B7280', fontWeight: '500', marginBottom: 12 },
  inputLabel: { fontSize: 13, fontWeight: '700', color: '#374151', marginBottom: 8, marginTop: 16 },
  input: { borderWidth: 1, borderColor: '#F3F4F6', borderRadius: 14, padding: 14, fontSize: 15, backgroundColor: '#F9FAFB', color: '#111827', fontWeight: '500' },
  phoneRow: { flexDirection: 'row', gap: 8 },
  countryCode: { borderWidth: 1, borderColor: '#F3F4F6', borderRadius: 14, paddingHorizontal: 16, justifyContent: 'center', backgroundColor: '#F9FAFB' },
  countryCodeText: { fontSize: 15, fontWeight: '700', color: '#111827' },
  phoneInput: { flex: 1, borderWidth: 1, borderColor: '#F3F4F6', borderRadius: 14, padding: 14, fontSize: 15, backgroundColor: '#F9FAFB', color: '#111827', fontWeight: '500' },
  phoneConfirmed: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#ECFDF5', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, marginBottom: 8 },
  phoneConfirmedText: { fontSize: 13, fontWeight: '700', color: '#059669' },
  testOtpBox: { backgroundColor: '#FEF3C7', borderWidth: 1, borderColor: '#FCD34D', borderRadius: 16, padding: 16, alignItems: 'center', marginBottom: 24 },
  testOtpHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  testOtpLabel: { fontSize: 11, color: '#92400E', fontWeight: '800', letterSpacing: 0.5 },
  testOtpCode: { fontSize: 36, fontWeight: '900', color: '#B45309', letterSpacing: 10, marginVertical: 8 },
  testOtpHint: { fontSize: 11, color: '#92400E' },
  otpInput: { borderWidth: 1, borderColor: '#10B981', borderRadius: 14, padding: 18, fontSize: 28, fontWeight: '800', textAlign: 'center', letterSpacing: 12, color: '#111827', backgroundColor: '#F9FAFB' },
  inputError: { borderColor: '#EF4444', backgroundColor: '#FEF2F2' },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  errorText: { color: '#EF4444', fontSize: 13, fontWeight: '600' },
  primaryBtn: { backgroundColor: '#111827', paddingVertical: 16, borderRadius: 14, alignItems: 'center', marginTop: 24 },
  btnDisabled: { opacity: 0.6 },
  primaryBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  resendRow: { paddingVertical: 16, alignItems: 'center' },
  resendText: { color: '#10B981', fontSize: 14, fontWeight: '700' },
  infoBox: { flexDirection: 'row', gap: 8, backgroundColor: '#F9FAFB', paddingHorizontal: 14, paddingVertical: 12, borderRadius: 12, marginTop: 20 },
  infoText: { fontSize: 12, color: '#6B7280', lineHeight: 18, flex: 1 },
  terms: { fontSize: 12, color: '#9CA3AF', textAlign: 'center', marginTop: 18, lineHeight: 18 },
});