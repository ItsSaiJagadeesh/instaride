/* InstaRide: a fork of RideFlow (GPL-3.0-or-later). Welcome screen: choose Rider or Driver, then sign in or sign up. */
import React, { useEffect, useRef } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator, Platform, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/lib/auth-context';
import { APP_VARIANT, APP_TITLE, roleAllowed } from '@/lib/variant';
import { DEMO_MODE, DEMO_PHONE, DEMO_CODE } from '@/lib/demo';
import Colors from '@/constants/colors';

function RoleCard({ role, icon, title, text }: { role: 'rider' | 'driver'; icon: string; title: string; text: string }) {
  return (
    <View style={s.card}>
      <View style={s.cardHead}>
        <View style={s.iconWrap}><Ionicons name={icon as any} size={26} color={Colors.primary} /></View>
        <View style={{ flex: 1 }}>
          <Text style={s.cardTitle}>{title}</Text>
          <Text style={s.cardText}>{text}</Text>
        </View>
      </View>
      <View style={s.btnRow}>
        <Pressable
          style={({ pressed }) => [s.primary, pressed && { opacity: 0.85 }]}
          onPress={() => router.push(`/auth?role=${role}&mode=signup`)}
          accessibilityRole="button"
          accessibilityLabel={`Create ${role} account`}
        >
          <Text style={s.primaryText}>Create account</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [s.secondary, pressed && { opacity: 0.85 }]}
          onPress={() => router.push(`/auth?role=${role}&mode=signin`)}
          accessibilityRole="button"
          accessibilityLabel={`Sign in as ${role}`}
        >
          <Text style={s.secondaryText}>Sign in</Text>
        </Pressable>
      </View>
    </View>
  );
}

export default function WelcomeScreen() {
  const { user, isLoading, logout } = useAuth();
  const insets = useSafeAreaInsets();
  const redirected = useRef(false);

  useEffect(() => {
    if (isLoading || !user || redirected.current) return;
    if (!roleAllowed(user.role as 'rider' | 'driver')) {
      // Signed in with an account that belongs to a different app: sign out and stay here.
      void logout();
      return;
    }
    redirected.current = true;
    router.replace(user.role === 'driver' ? '/driver' : '/rider');
  }, [user, isLoading, logout]);

  if (isLoading || (user && roleAllowed(user.role as 'rider' | 'driver'))) {
    return (
      <View style={[s.screen, { alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  const top = Platform.OS === 'web' ? 40 : insets.top + 24;
  const bottom = Platform.OS === 'web' ? 24 : insets.bottom + 16;
  return (
    <View style={s.screen}>
      <ScrollView contentContainerStyle={{ paddingTop: top, paddingBottom: bottom, paddingHorizontal: 20 }} showsVerticalScrollIndicator={false}>
        <View style={s.brand}>
          <View style={s.logo}><Ionicons name="navigate" size={34} color={Colors.secondary} /></View>
          <Text style={s.appName}>{APP_TITLE}</Text>
          <Text style={s.tagline}>Local rides, fair pay</Text>
        </View>

        {DEMO_MODE && (
          <View style={s.demo} accessibilityRole="alert">
            <Text style={s.demoTitle}>DEMO VERSION</Text>
            <Text style={s.demoText}>
              Works without internet. Choose Rider or Driver, then sign in with {DEMO_PHONE} and the code {DEMO_CODE}. You can look at every screen. Booking and accepting rides are switched off.
            </Text>
          </View>
        )}

        {(APP_VARIANT === 'all' || APP_VARIANT === 'rider') && (
          <RoleCard role="rider" icon="person" title="I need a ride" text="Book a ride, track your driver and share your trip. Pay in cash." />
        )}
        {(APP_VARIANT === 'all' || APP_VARIANT === 'driver') && (
          <RoleCard role="driver" icon="car" title="I want to drive" text="Pay a flat fee per ride, not a commission. Every driver and vehicle is checked by hand." />
        )}

        <Text style={s.foot}>You sign in with a code sent to your mobile number. No password needed.</Text>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.backgroundDark },
  brand: { alignItems: 'center', marginBottom: 28 },
  logo: { width: 68, height: 68, borderRadius: 20, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  appName: { fontSize: 32, fontFamily: 'Inter_700Bold', color: Colors.textWhite },
  tagline: { fontSize: 15, fontFamily: 'Inter_400Regular', color: Colors.textLight, marginTop: 4 },
  card: { backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 20, padding: 18, marginBottom: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  cardHead: { flexDirection: 'row', gap: 14, alignItems: 'center', marginBottom: 16 },
  iconWrap: { width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(0,217,165,0.14)', alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontSize: 19, fontFamily: 'Inter_600SemiBold', color: Colors.textWhite },
  cardText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: Colors.textLight, marginTop: 3, lineHeight: 18 },
  btnRow: { flexDirection: 'row', gap: 10 },
  primary: { flex: 1, backgroundColor: Colors.primary, borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  primaryText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: Colors.secondary },
  secondary: { flex: 1, borderRadius: 12, paddingVertical: 13, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)' },
  secondaryText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: Colors.textWhite },
  demo: { backgroundColor: 'rgba(255,204,0,0.12)', borderColor: Colors.warning, borderWidth: 1, borderRadius: 16, padding: 14, marginBottom: 16 },
  demoTitle: { fontSize: 12, letterSpacing: 1, fontFamily: 'Inter_700Bold', color: Colors.warning, marginBottom: 4 },
  demoText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: Colors.textWhite, lineHeight: 19 },
  foot: { textAlign: 'center', fontSize: 13, color: Colors.textLight, fontFamily: 'Inter_400Regular', marginTop: 8, lineHeight: 19 },
});
