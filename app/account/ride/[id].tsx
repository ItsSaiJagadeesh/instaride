/* InstaRide: a fork of RideFlow (GPL-3.0-or-later). One ride's details and receipt. */
import React from 'react';
import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { Screen, Card, MenuRow, SectionLabel, PrimaryButton, ErrorNote } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { useApiGet } from '@/lib/use-api';
import { formatDateTime, formatINR, VEHICLE_LABELS } from '@/lib/format';
import Colors from '@/constants/colors';
import type { Ride } from '@shared/schema';

function Line({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 }}>
      <Text style={{ fontFamily: bold ? 'Inter_600SemiBold' : 'Inter_400Regular', color: bold ? Colors.text : Colors.textLight, fontSize: 14 }}>{label}</Text>
      <Text style={{ fontFamily: bold ? 'Inter_700Bold' : 'Inter_500Medium', color: Colors.text, fontSize: 14 }}>{value}</Text>
    </View>
  );
}

export default function RideDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const isDriver = user?.role === 'driver';
  const { data: r, loading, error, reload } = useApiGet<Ride>(id ? `/api/rides/${id}` : null);

  return (
    <Screen title="Ride details" refreshing={loading} onRefresh={reload}>
      {error ? <ErrorNote message={error} onRetry={reload} /> : null}
      {r ? (
        <>
          <Card>
            <MenuRow icon="radio-button-on" title="Pickup" subtitle={r.pickup.address} />
            <MenuRow icon="location" title="Drop" subtitle={r.dropoff.address} last />
          </Card>

          <SectionLabel>Trip</SectionLabel>
          <Card style={{ padding: 14 }}>
            <Line label="Status" value={r.status.replace('_', ' ')} />
            <Line label="Vehicle type" value={VEHICLE_LABELS[r.vehicleType] ?? r.vehicleType} />
            <Line label="Booked" value={formatDateTime(r.createdAt)} />
            {r.startedAt ? <Line label="Started" value={formatDateTime(r.startedAt)} /> : null}
            {r.completedAt ? <Line label={r.status === 'cancelled' ? 'Cancelled' : 'Finished'} value={formatDateTime(r.completedAt)} /> : null}
            {r.distance ? <Line label="Distance (approx.)" value={`${r.distance} km`} /> : null}
            {!isDriver && r.driverName ? <Line label="Driver" value={r.driverName} /> : null}
            {!isDriver && r.driverVehicle ? <Line label="Vehicle number" value={r.driverVehicle.number} /> : null}
            {isDriver && r.riderName ? <Line label="Rider" value={r.riderName} /> : null}
          </Card>

          {r.fare && r.status !== 'cancelled' ? (
            <>
              <SectionLabel>{isDriver ? 'Earnings' : 'Fare'}</SectionLabel>
              <Card style={{ padding: 14 }}>
                <Line label="Base fare" value={formatINR(r.fare.baseFare)} />
                <Line label="Distance" value={formatINR(r.fare.distanceFare)} />
                <Line label="Time" value={formatINR(r.fare.timeFare)} />
                <Line label="Total fare (paid in cash)" value={formatINR(r.fare.totalFare)} bold />
                {isDriver ? (
                  <>
                    <Line label="Platform fee" value={`− ${formatINR(r.fare.platformFee)}`} />
                    <Line label="You keep" value={formatINR(r.fare.driverEarnings)} bold />
                  </>
                ) : null}
              </Card>
            </>
          ) : null}

          {!isDriver && r.review ? (
            <>
              <SectionLabel>Your rating</SectionLabel>
              <Card style={{ padding: 14, flexDirection: 'row', gap: 4 }}>
                {[1, 2, 3, 4, 5].map((n) => <Ionicons key={n} name={n <= r.review!.rating ? 'star' : 'star-outline'} size={22} color={Colors.warning} />)}
              </Card>
            </>
          ) : null}

          <Text style={{ marginTop: 16, fontSize: 12, color: Colors.textLight, fontFamily: 'Inter_400Regular' }}>Trip reference: {r.id.slice(0, 8).toUpperCase()}</Text>
          <View style={{ marginTop: 14 }}>
            <PrimaryButton title="Get help with this ride" variant="ghost" onPress={() => router.push('/account/help')} />
          </View>
        </>
      ) : null}
    </Screen>
  );
}
