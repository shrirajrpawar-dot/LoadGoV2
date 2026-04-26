import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  Alert, ActivityIndicator, KeyboardAvoidingView, Platform,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

export default function LoginScreen({ onLogin }) {
  const [step, setStep] = useState('details'); // 'details' or 'otp'
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [generatedOtp, setGeneratedOtp] = useState('');
  const [otpInput, setOtpInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const validateEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
  const validatePhone = (p) => /^[0-9]{10}$/.test(p);

  const handleSendOtp = () => {
    setError('');
    if (!name.trim()) { setError('Please enter your name'); return; }
    if (!validateEmail(email)) { setError('Please enter a valid email'); return; }
    if (!validatePhone(phone)) { setError('Please enter a valid 10-digit mobile number'); return; }

    const otp = Math.floor(1000 + Math.random() * 9000).toString();
    setGeneratedOtp(otp);
    setStep('otp');
    console.log('Generated OTP:', otp);
  };

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
      await onLogin(name.trim(), email.trim(), phone.trim());
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  if (step === 'otp') {
    return (
      <SafeAreaView style={styles.container}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1 }}
        >
          <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
            <TouchableOpacity style={styles.backRow} onPress={() => setStep('details')}>
              <Ionicons name="arrow-back" size={20} color="#111827" />
              <Text style={styles.backText}>Back</Text>
            </TouchableOpacity>

            <View style={styles.headerSection}>
              <View style={styles.logoCircle}>
                <Ionicons name="shield-checkmark" size={32} color="#10B981" />
              </View>
              <Text style={styles.title}>Verify OTP</Text>
              <Text style={styles.subtitle}>OTP sent to +91 {phone}</Text>
            </View>

            <View style={styles.testOtpBox}>
              <View style={styles.testOtpHeader}>
                <Ionicons name="flask-outline" size={16} color="#92400E" />
                <Text style={styles.testOtpLabel}>TEST MODE</Text>
              </View>
              <Text style={styles.testOtpCode}>{generatedOtp}</Text>
              <Text style={styles.testOtpHint}>In production, this will be sent via SMS</Text>
            </View>

            <Text style={styles.inputLabel}>Enter 4-digit OTP</Text>
            <TextInput
              style={[styles.otpInput, error && styles.inputError]}
              value={otpInput}
              onChangeText={(t) => {
                setOtpInput(t.replace(/[^0-9]/g, '').slice(0, 4));
                setError('');
              }}
              placeholder="0 0 0 0"
              placeholderTextColor="#D1D5DB"
              keyboardType="numeric"
              maxLength={4}
              autoFocus
            />

            {error ? (
              <View style={styles.errorRow}>
                <Ionicons name="alert-circle" size={14} color="#EF4444" />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            <TouchableOpacity
              style={[styles.primaryBtn, loading && styles.btnDisabled]}
              onPress={handleVerifyOtp}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryBtnText}>Verify & Continue</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity onPress={handleSendOtp} style={styles.resendRow}>
              <Text style={styles.resendText}>Didn't get OTP? Resend</Text>
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.headerSection}>
            <View style={styles.logoCircle}>
              <Ionicons name="cube" size={36} color="#10B981" />
            </View>
            <Text style={styles.appName}>LoadGo</Text>
            <Text style={styles.tagline}>Fast Delivery, Anywhere</Text>
          </View>

          <View style={styles.formSection}>
            <Text style={styles.formTitle}>Create Account / Login</Text>
            <Text style={styles.formSub}>We'll send a one-time code to verify</Text>

            <Text style={styles.inputLabel}>Full Name</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={(t) => { setName(t); setError(''); }}
              placeholder="Enter your full name"
              placeholderTextColor="#9CA3AF"
              autoCapitalize="words"
            />

            <Text style={styles.inputLabel}>Email Address</Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={(t) => { setEmail(t.toLowerCase()); setError(''); }}
              placeholder="your@email.com"
              placeholderTextColor="#9CA3AF"
              keyboardType="email-address"
              autoCapitalize="none"
            />

            <Text style={styles.inputLabel}>Mobile Number</Text>
            <View style={styles.phoneRow}>
              <View style={styles.countryCode}>
                <Text style={styles.countryCodeText}>+91</Text>
              </View>
              <TextInput
                style={styles.phoneInput}
                value={phone}
                onChangeText={(t) => {
                  setPhone(t.replace(/[^0-9]/g, '').slice(0, 10));
                  setError('');
                }}
                placeholder="10-digit number"
                placeholderTextColor="#9CA3AF"
                keyboardType="numeric"
                maxLength={10}
              />
            </View>

            {error ? (
              <View style={styles.errorRow}>
                <Ionicons name="alert-circle" size={14} color="#EF4444" />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            <TouchableOpacity style={styles.primaryBtn} onPress={handleSendOtp}>
              <Text style={styles.primaryBtnText}>Send OTP</Text>
            </TouchableOpacity>

            <Text style={styles.terms}>
              By continuing, you agree to our Terms of Service and Privacy Policy
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
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

  terms: { fontSize: 12, color: '#9CA3AF', textAlign: 'center', marginTop: 18, lineHeight: 18 },
});