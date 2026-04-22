export const colors = {
  primary: '#10B981',
  primaryDark: '#059669',
  bg: '#F9FAFB',
  surface: '#FFFFFF',
  text: '#1F2937',
  textDim: '#6B7280',
  textMute: '#9CA3AF',
  border: '#E5E7EB',
  info: '#3B82F6',
  warning: '#F59E0B',
  error: '#EF4444',
  success: '#10B981',
};

export const font = {
  display: { fontSize: 32, fontWeight: '800', color: colors.text },
  title: { fontSize: 24, fontWeight: '700', color: colors.text },
  heading: { fontSize: 18, fontWeight: '600', color: colors.text },
  body: { fontSize: 15, color: colors.text },
  small: { fontSize: 13, color: colors.textDim },
  label: { fontSize: 12, fontWeight: '600', color: colors.textMute, letterSpacing: 0.5 },
};

export const spacing = {
  xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32,
};

export const radius = {
  sm: 6, md: 8, lg: 12, xl: 16, full: 999,
};
