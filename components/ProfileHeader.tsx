/* InstaRide: a fork of RideFlow (GPL-3.0-or-later).
 * The top of the profile: name, number, email, the person's rating (what the other side said, as stars and a count) and, for a driver,
 * what they have earned. The rating comes from the anonymous reviews list, so it never shows who said what. */
import React, { useCallback, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '@/components/ui';
import Colors from '@/constants/colors';
import { useAuth } from '@/lib/auth-context';
import { apiRequest } from '@/lib/query-client';
import { formatINR } from '@/lib/format';

export default function ProfileHeader() {
  const { user } = useAuth();
  const [sum, setSum] = useState<{ average: number | null; count: number } | null>(null);
  const isDriver = user?.role === 'driver';
  const initial = (user?.fullName || '?').trim().charAt(0).toUpperCase();

  useFocusEffect(
    useCallback(() => {
      if (!user) return;
      let live = true;
      (async () => {
        try {
          const res = await apiRequest('GET', isDriver ? '/api/driver/reviews' : '/api/rider/reviews');
          const d = await res.json();
          if (live) setSum({ average: d.average, count: d.count });
        } catch {}
      })();
      return () => { live = false; };
    }, [user?.id, isDriver]),
  );

  return (
    <Card>
      <View style={styles.top}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initial}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.name}>{user?.fullName}</Text>
          <Text style={styles.sub}>{user?.phone}</Text>
          {!!user?.email && <Text style={styles.sub}>{user.email}</Text>}
        </View>
      </View>

      <Pressable
        onPress={() => router.push('/account/my-reviews')}
        accessibilityLabel="Your rating"
        style={({ pressed }) => [styles.ratingRow, pressed && { opacity: 0.7 }]}
      >
        <Ionicons name="star" size={18} color="#FFB800" />
        {!sum ? (
          <Text style={styles.ratingSub}>Loading your rating…</Text>
        ) : sum.count > 0 ? (
          <Text style={styles.ratingText}>
            {sum.average?.toFixed(1)} <Text style={styles.ratingSub}>· {sum.count} {sum.count === 1 ? 'review' : 'reviews'} from {isDriver ? 'riders' : 'drivers'}</Text>
          </Text>
        ) : (
          <Text style={styles.ratingSub}>No ratings yet. {isDriver ? 'Riders' : 'Drivers'} can rate you after a trip.</Text>
        )}
        <Ionicons name="chevron-forward" size={16} color={Colors.textLight} style={{ marginLeft: 'auto' }} />
      </Pressable>

      {isDriver && (
        <View style={styles.statsRow} accessibilityLabel="Your earnings">
          <Stat label="Earned" value={formatINR(user?.totalEarnings ?? 0)} />
          <Stat label="Trips" value={String(user?.totalRides ?? 0)} />
          <Stat label="Tips" value={formatINR(user?.totalTips ?? 0)} />
          <Stat label="Fees due" value={formatINR(user?.feesDue ?? 0)} warn={(user?.feesDue ?? 0) > 0} />
        </View>
      )}
    </Card>
  );
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, warn && { color: Colors.warning }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16 },
  avatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: 'Inter_700Bold', fontSize: 24, color: Colors.secondary },
  name: { fontFamily: 'Inter_600SemiBold', fontSize: 18, color: Colors.text },
  sub: { fontFamily: 'Inter_400Regular', fontSize: 14, color: Colors.textLight },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1, borderTopColor: Colors.border },
  ratingText: { fontFamily: 'Inter_700Bold', fontSize: 16, color: Colors.text },
  ratingSub: { fontFamily: 'Inter_400Regular', fontSize: 13, color: Colors.textLight },
  statsRow: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: Colors.border, paddingVertical: 12 },
  stat: { flex: 1, alignItems: 'center', gap: 2 },
  statValue: { fontFamily: 'Inter_700Bold', fontSize: 16, color: Colors.text },
  statLabel: { fontFamily: 'Inter_400Regular', fontSize: 12, color: Colors.textLight },
});
