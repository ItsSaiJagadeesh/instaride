/* InstaRide: a fork of RideFlow (GPL-3.0-or-later). Ride history list for InstaRiders and InstaDrivers. */
import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Screen, Card, Empty, ErrorNote } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { useApiGet } from '@/lib/use-api';
import { formatDateTime, formatINR, VEHICLE_LABELS } from '@/lib/format';
import Colors from '@/constants/colors';
import type { Ride } from '@shared/schema';

const STATUS_LABEL: Record<string, string> = {
  requested: 'Looking for a driver', accepted: 'Driver assigned', arriving: 'Driver on the way', arrived: 'Driver arrived',
  in_progress: 'In progress', completed: 'Completed', cancelled: 'Cancelled',
};

export default function RideHistory({ back = true }: { back?: boolean }) {
  const { user } = useAuth();
  const isDriver = user?.role === 'driver';
  const { data, loading, error, reload } = useApiGet<Ride[]>(user ? `/api/rides/${isDriver ? 'driver' : 'rider'}/${user.id}` : null);
  const rides = data ?? [];

  return (
    <Screen title="My rides" back={back} refreshing={loading} onRefresh={reload}>
      {error ? <ErrorNote message={error} onRetry={reload} /> : null}
      {!error && !loading && rides.length === 0 ? (
        <Empty icon="car-outline" title="No rides yet" text={isDriver ? 'Rides you complete will appear here.' : 'Book your first ride from the Home tab.'} />
      ) : null}
      {rides.length > 0 ? (
        <Card>
          {rides.map((r, i) => {
            const done = r.status === 'completed';
            const cancelled = r.status === 'cancelled';
            const amount = r.fare ? (isDriver ? r.fare.driverEarnings : r.fare.totalFare) : 0;
            return (
              <Pressable
                key={r.id}
                onPress={() => router.push(`/account/ride/${r.id}`)}
                style={({ pressed }) => [{ flexDirection: 'row', gap: 12, padding: 14, alignItems: 'center' }, i < rides.length - 1 && { borderBottomWidth: 0.5, borderBottomColor: Colors.border }, pressed && { backgroundColor: Colors.background }]}
              >
                <View style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: cancelled ? 'rgba(255,59,48,0.10)' : 'rgba(0,217,165,0.12)' }}>
                  <Ionicons name={cancelled ? 'close' : done ? 'checkmark' : 'time-outline'} size={20} color={cancelled ? Colors.error : Colors.primaryDark} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text numberOfLines={1} style={{ fontFamily: 'Inter_600SemiBold', fontSize: 15, color: Colors.text }}>{r.dropoff.address || 'Destination'}</Text>
                  <Text numberOfLines={1} style={{ fontFamily: 'Inter_400Regular', fontSize: 13, color: Colors.textLight }}>from {r.pickup.address || 'pickup'}</Text>
                  <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 12, color: Colors.textLight, marginTop: 2 }}>
                    {formatDateTime(r.createdAt)} · {VEHICLE_LABELS[r.vehicleType] ?? r.vehicleType} · {STATUS_LABEL[r.status] ?? r.status}
                  </Text>
                </View>
                <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 15, color: cancelled ? Colors.textLight : Colors.text }}>{cancelled ? '₹0' : formatINR(amount)}</Text>
              </Pressable>
            );
          })}
        </Card>
      ) : null}
    </Screen>
  );
}
