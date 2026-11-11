/* InstaRide: a fork of RideFlow (GPL-3.0-or-later). Activity feed built from ride events. */
import React, { useEffect } from 'react';
import { Text, View } from 'react-native';
import { Screen, Card, MenuRow, Empty, ErrorNote } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { useApiGet } from '@/lib/use-api';
import { apiRequest } from '@/lib/query-client';
import { formatDateTime, formatINR } from '@/lib/format';
import type { RideEvent } from '@shared/schema';

function describe(e: RideEvent, role?: string): { icon: string; title: string; text?: string } {
  const d = e.data as any;
  switch (e.type) {
    case 'ride_requested':
      return role === 'driver'
        ? { icon: 'notifications-outline', title: 'New ride request nearby', text: d.pickup?.address ? `From ${d.pickup.address}` : undefined }
        : { icon: 'search-outline', title: 'Ride requested', text: 'We are looking for a driver.' };
    case 'ride_accepted': return { icon: 'checkmark-circle-outline', title: `${d.driverName || 'A driver'} accepted your ride` };
    case 'driver_arriving': return { icon: 'navigate-outline', title: 'Your driver is on the way' };
    case 'driver_arrived': return { icon: 'location-outline', title: 'Your driver has arrived' };
    case 'ride_started': return { icon: 'play-circle-outline', title: 'Trip started' };
    case 'ride_completed':
      return { icon: 'flag-outline', title: 'Trip completed', text: d.fare?.totalFare ? `Fare ${formatINR(d.fare.totalFare)}` : undefined };
    case 'ride_cancelled':
      return d.searchingAgain
        ? { icon: 'refresh-outline', title: 'Your driver cancelled', text: 'We are finding you another driver.' }
        : { icon: 'close-circle-outline', title: 'Ride cancelled', text: d.by ? `Cancelled by the ${d.by}.` : undefined };
    case 'verification_update':
      return {
        icon: 'shield-checkmark-outline',
        title: d.status === 'approved' ? 'Your vehicle was approved' : d.status === 'needs_fix' ? 'Please upload some photos again' : 'Verification update',
        text: d.reason || undefined,
      };
    case 'sos_alert': return { icon: 'alert-circle-outline', title: 'SOS sent to our team' };
    default: return { icon: 'notifications-outline', title: 'Update' };
  }
}

export default function NotificationsScreen() {
  const { user } = useAuth();
  const { data, loading, error, reload } = useApiGet<RideEvent[]>(user ? `/api/events/${user.id}` : null);

  // Mark everything as read once the list has been shown.
  useEffect(() => {
    (data ?? []).filter((e) => !e.read).forEach((e) => { void apiRequest('PUT', `/api/events/${e.id}/read`).catch(() => {}); });
  }, [data]);

  return (
    <Screen title="Notifications" refreshing={loading} onRefresh={reload}>
      {error ? <ErrorNote message={error} onRetry={reload} /> : null}
      {!error && !loading && (data ?? []).length === 0 ? (
        <Empty icon="notifications-off-outline" title="Nothing yet" text="Updates about your rides will appear here." />
      ) : null}
      {(data ?? []).length > 0 ? (
        <Card>
          {(data ?? []).map((e, i, arr) => {
            const x = describe(e, user?.role);
            return (
              <MenuRow
                key={e.id}
                icon={x.icon}
                title={x.title}
                subtitle={[x.text, formatDateTime(e.createdAt)].filter(Boolean).join(' · ')}
                right={!e.read ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#00D9A5' }} /> : <Text />}
                last={i === arr.length - 1}
              />
            );
          })}
        </Card>
      ) : null}
    </Screen>
  );
}
