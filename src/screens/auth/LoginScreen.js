import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  Alert, ActivityIndicator, KeyboardAvoidingView, Platform,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

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

    // Generate OTP
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
          <ScrollView contentContainerStyle={styles.scroll}>
            <TouchableOpacity onPress={() => setStep('details')}>
              <Text style={styles.backBtn}>← Back</Text>
            </TouchableOpacity>

            <View style={styles.headerSection}>
              <Text style={styles.logo}>📦</Text>
              <Text style={styles.title}>Verify OTP</Text>
              <Text style={styles.subtitle}>
                OTP sent to {phone}
              </Text>
            </View>

            {/* Test OTP Display */}
            <View style={styles.testOtpBox}>
              <Text style={styles.testOtpLabel}>🧪 TEST MODE - Your OTP is:</Text>
              <Text style={styles.testOtpCode}>{generatedOtp}</Text>
              <Text style={styles.testOtpHint}>
                In production, this will be sent via SMS
              </Text>
            </View>

            <Text style={styles.inputLabel}>ENTER OTP</Text>
            <TextInput
              style={[styles.otpInput, error && styles.inputError]}
              value={otpInput}
              onChangeText={(t) => {
                setOtpInput(t.replace(/[^0-9]/g, '').slice(0, 4));
                setError('');
              }}
              placeholder="0 0 0 0"
              keyboardType="numeric"
              maxLength={4}
              autoFocus
            />

            {error ? <Text style={styles.errorText}>{error}</Text> : null}

            <TouchableOpacity
              style={[styles.primaryBtn, loading && styles.btnDisabled]}
              onPress={handleVerifyOtp}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryBtnText}>Verify & Login</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity onPress={handleSendOtp}>
              <Text style={styles.resendText}>Resend OTP</Text>
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
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={styles.headerSection}>
            <Text style={styles.logo}>📦</Text>
            <Text style={styles.appName}>LoadGo</Text>
            <Text style={styles.tagline}>Fast Delivery, Anywhere</Text>
          </View>

          <View style={styles.formSection}>
            <Text style={styles.formTitle}>Create Account / Login</Text>

            <Text style={styles.inputLabel}>FULL NAME</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={(t) => { setName(t); setError(''); }}
              placeholder="Enter your full name"
              autoCapitalize="words"
            />

            <Text style={styles.inputLabel}>EMAIL ADDRESS</Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={(t) => { setEmail(t.toLowerCase()); setError(''); }}
              placeholder="your@email.com"
              keyboardType="email-address"
              autoCapitalize="none"
            />

            <Text style={styles.inputLabel}>MOBILE NUMBER</Text>
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
                placeholder="10-digit mobile number"
                keyboardType="numeric"
                maxLength={10}
              />
            </View>

            {error ? <Text style={styles.errorText}>{error}</Text> : null}

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
  container: { flex: 1, backgroundColor: '#fff' },
  scroll: { padding: 24, paddingBottom: 40 },
  backBtn: { fontSize: 16, color: '#10B981', fontWeight: '600', marginBottom: 20 },
  headerSection: { alignItems: 'center', marginBottom: 40, marginTop: 20 },
  logo: { fontSize: 64, marginBottom: 12 },
  appName: { fontSize: 36, fontWeight: '800', color: '#1F2937' },
  tagline: { fontSize: 16, color: '#6B7280', marginTop: 8 },
  title: { fontSize: 28, fontWeight: '700', color: '#1F2937' },
  subtitle: { fontSize: 14, color: '#6B7280', marginTop: 8 },
  formSection: { flex: 1 },
  formTitle: { fontSize: 20, fontWeight: '700', color: '#1F2937', marginBottom: 24 },
  inputLabel: {
    fontSize: 12, fontWeight: '700', color: '#6B7280',
    marginBottom: 8, marginTop: 16, letterSpacing: 0.5,
  },
  input: {
    borderWidth: 1.5, borderColor: '#E5E7EB', borderRadius: 12,
    padding: 14, fontSize: 16, backgroundColor: '#F9FAFB', color: '#1F2937',
  },
  phoneRow: { flexDirection: 'row', gap: 8 },
  countryCode: {
    borderWidth: 1.5, borderColor: '#E5E7EB', borderRadius: 12,
    paddingHorizontal: 16, justifyContent: 'center', backgroundColor: '#F9FAFB',
  },
  countryCodeText: { fontSize: 16, fontWeight: '600', color: '#1F2937' },
  phoneInput: {
    flex: 1, borderWidth: 1.5, borderColor: '#E5E7EB', borderRadius: 12,
    padding: 14, fontSize: 16, backgroundColor: '#F9FAFB', color: '#1F2937',
  },
  testOtpBox: {
    backgroundColor: '#FEF3C7', borderWidth: 2, borderColor: '#F59E0B',
    borderRadius: 12, padding: 16, alignItems: 'center', marginBottom: 24,
  },
  testOtpLabel: { fontSize: 12, color: '#92400E', fontWeight: '600' },
  testOtpCode: {
    fontSize: 36, fontWeight: '800', color: '#D97706',
    letterSpacing: 8, marginVertical: 8,
  },
  testOtpHint: { fontSize: 11, color: '#92400E', fontStyle: 'italic' },
  otpInput: {
    borderWidth: 2, borderColor: '#10B981', borderRadius: 12,
    padding: 16, fontSize: 32, fontWeight: '700', textAlign: 'center',
    letterSpacing: 12, color: '#1F2937', backgroundColor: '#F9FAFB',
  },
  inputError: { borderColor: '#EF4444', backgroundColor: '#FEF2F2' },
  errorText: {
    color: '#EF4444', fontSize: 13, fontWeight: '600', marginTop: 8,
  },
  primaryBtn: {
    backgroundColor: '#10B981', padding: 16, borderRadius: 12,
    alignItems: 'center', marginTop: 24,
  },
  btnDisabled: { opacity: 0.6 },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  resendText: {
    color: '#10B981', fontSize: 14, fontWeight: '600',
    textAlign: 'center', marginTop: 20,
  },
  terms: {
    fontSize: 12, color: '#9CA3AF', textAlign: 'center',
    marginTop: 24, lineHeight: 18,
  },
});
