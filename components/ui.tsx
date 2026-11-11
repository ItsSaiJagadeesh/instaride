/* InstaRide: a fork of RideFlow (GPL-3.0-or-later). Shared building blocks for the account screens. */
import React from 'react';
import {
  View, Text, Pressable, StyleSheet, ScrollView, TextInput, TextInputProps,
  ActivityIndicator, Platform, RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, Redirect } from 'expo-router';
import { useAuth } from '@/lib/auth-context';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Colors from '@/constants/colors';

export function Screen({
  title, children, back = true, scroll = true, refreshing, onRefresh, requireAuth = true,
}: {
  requireAuth?: boolean;
  title: string;
  children: React.ReactNode;
  back?: boolean;
  scroll?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { user, isLoading } = useAuth();
  const top = Platform.OS === 'web' ? 24 : insets.top;
  const bottom = Platform.OS === 'web' ? 24 : insets.bottom;
  // A signed-out visitor (for example after pressing Back) goes to the welcome screen.
  if (requireAuth && !isLoading && !user) return <Redirect href="/" />;
  return (
    <View style={[s.screen, { paddingTop: top }]}>
      <View style={s.header}>
        {back ? (
          <Pressable onPress={() => router.back()} style={s.backBtn} hitSlop={10} accessibilityLabel="Go back">
            <Ionicons name="arrow-back" size={24} color={Colors.text} />
          </Pressable>
        ) : <View style={s.backBtn} />}
        <Text style={s.headerTitle} numberOfLines={1}>{title}</Text>
        <View style={s.backBtn} />
      </View>
      {scroll ? (
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: bottom + 32 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} /> : undefined}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={{ flex: 1 }}>{children}</View>
      )}
    </View>
  );
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return <Text style={s.sectionLabel}>{children}</Text>;
}

export function Card({ children, style }: { children: React.ReactNode; style?: object }) {
  return <View style={[s.card, style]}>{children}</View>;
}

export function MenuRow({
  icon, title, subtitle, onPress, danger, right, last,
}: {
  icon: string;
  title: string;
  subtitle?: string;
  onPress?: () => void;
  danger?: boolean;
  right?: React.ReactNode;
  last?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [s.row, !last && s.rowBorder, pressed && { backgroundColor: Colors.background }]}
      accessibilityRole="button"
    >
      <View style={[s.rowIcon, danger && { backgroundColor: 'rgba(255,59,48,0.10)' }]}>
        <Ionicons name={icon as any} size={20} color={danger ? Colors.error : Colors.primaryDark} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[s.rowTitle, danger && { color: Colors.error }]}>{title}</Text>
        {subtitle ? <Text style={s.rowSub} numberOfLines={2}>{subtitle}</Text> : null}
      </View>
      {right ?? (onPress ? <Ionicons name="chevron-forward" size={18} color={Colors.textLight} /> : null)}
    </Pressable>
  );
}

export function Field({ label, hint, ...props }: { label: string; hint?: string } & TextInputProps) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={s.fieldLabel}>{label}</Text>
      <TextInput
        style={s.input}
        placeholderTextColor={Colors.textLight}
        autoCorrect={false}
        {...props}
      />
      {hint ? <Text style={s.hint}>{hint}</Text> : null}
    </View>
  );
}

export function PrimaryButton({
  title, onPress, loading, disabled, variant = 'primary',
}: {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: 'primary' | 'danger' | 'ghost';
}) {
  const bg = variant === 'primary' ? Colors.primary : variant === 'danger' ? Colors.error : 'transparent';
  const fg = variant === 'primary' ? Colors.secondary : variant === 'danger' ? '#fff' : Colors.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        s.btn, { backgroundColor: bg, borderWidth: variant === 'ghost' ? 1 : 0, borderColor: Colors.border },
        (disabled || loading) && { opacity: 0.5 }, pressed && { opacity: 0.85 },
      ]}
      accessibilityRole="button"
    >
      {loading ? <ActivityIndicator color={fg} /> : <Text style={[s.btnText, { color: fg }]}>{title}</Text>}
    </Pressable>
  );
}

export function Empty({ icon, title, text }: { icon: string; title: string; text?: string }) {
  return (
    <View style={s.empty}>
      <Ionicons name={icon as any} size={44} color={Colors.textLight} />
      <Text style={s.emptyTitle}>{title}</Text>
      {text ? <Text style={s.emptyText}>{text}</Text> : null}
    </View>
  );
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View style={s.empty}>
      <Ionicons name="cloud-offline-outline" size={44} color={Colors.error} />
      <Text style={s.emptyTitle}>Something went wrong</Text>
      <Text style={s.emptyText}>{message}</Text>
      {onRetry ? <View style={{ marginTop: 12, width: 160 }}><PrimaryButton title="Try again" onPress={onRetry} variant="ghost" /></View> : null}
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, paddingVertical: 10, backgroundColor: Colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.border,
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontFamily: 'Inter_600SemiBold', color: Colors.text },
  sectionLabel: {
    fontSize: 12, fontFamily: 'Inter_600SemiBold', color: Colors.textLight, textTransform: 'uppercase',
    letterSpacing: 0.6, marginTop: 18, marginBottom: 8, marginLeft: 4,
  },
  card: {
    backgroundColor: Colors.surface, borderRadius: 14, borderWidth: 1, borderColor: Colors.border, overflow: 'hidden',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 14 },
  rowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.border },
  rowIcon: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,217,165,0.12)',
    alignItems: 'center', justifyContent: 'center',
  },
  rowTitle: { fontSize: 15, fontFamily: 'Inter_500Medium', color: Colors.text },
  rowSub: { fontSize: 13, fontFamily: 'Inter_400Regular', color: Colors.textLight, marginTop: 2 },
  fieldLabel: { fontSize: 13, fontFamily: 'Inter_500Medium', color: Colors.textLight, marginBottom: 6 },
  input: {
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, fontFamily: 'Inter_400Regular', color: Colors.text,
  },
  hint: { fontSize: 12, fontFamily: 'Inter_400Regular', color: Colors.textLight, marginTop: 6, lineHeight: 17 },
  btn: { paddingVertical: 14, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  btnText: { fontSize: 16, fontFamily: 'Inter_600SemiBold' },
  empty: { alignItems: 'center', paddingVertical: 48, paddingHorizontal: 24, gap: 8 },
  emptyTitle: { fontSize: 17, fontFamily: 'Inter_600SemiBold', color: Colors.text, textAlign: 'center' },
  emptyText: { fontSize: 14, fontFamily: 'Inter_400Regular', color: Colors.textLight, textAlign: 'center', lineHeight: 20 },
});
