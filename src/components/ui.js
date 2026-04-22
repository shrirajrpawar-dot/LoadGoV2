import React from 'react';
import { TouchableOpacity, Text, View, StyleSheet, ActivityIndicator } from 'react-native';

export function Button({ title, onPress, disabled, loading, style, variant = 'primary' }) {
  const isPrimary = variant === 'primary';
  return (
    <TouchableOpacity
      style={[
        styles.btn,
        isPrimary ? styles.btnPrimary : styles.btnOutline,
        disabled && styles.btnDisabled,
        style,
      ]}
      onPress={onPress}
      disabled={disabled || loading}
    >
      {loading ? (
        <ActivityIndicator color={isPrimary ? '#fff' : '#10B981'} />
      ) : (
        <Text style={[styles.btnText, !isPrimary && styles.btnTextOutline]}>
          {title}
        </Text>
      )}
    </TouchableOpacity>
  );
}

export function Card({ children, style }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  btn: {
    borderRadius: 12, paddingVertical: 14, paddingHorizontal: 24,
    alignItems: 'center', justifyContent: 'center',
  },
  btnPrimary: { backgroundColor: '#10B981' },
  btnOutline: { backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#10B981' },
  btnDisabled: { opacity: 0.5 },
  btnText: { fontSize: 16, fontWeight: '700', color: '#fff' },
  btnTextOutline: { color: '#10B981' },
  card: {
    backgroundColor: '#fff', borderRadius: 12, padding: 16,
    borderWidth: 1, borderColor: '#E5E7EB',
  },
});
