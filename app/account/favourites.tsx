/* InstaRide: a fork of RideFlow (GPL-3.0-or-later). Saved places (InstaRider only). */
import React, { useState } from 'react';
import { Text } from 'react-native';
import { Screen, Card, MenuRow, Empty } from '@/components/ui';
import AppModal, { useAppModal } from '@/components/AppModal';
import { useAuth } from '@/lib/auth-context';
import { apiRequest } from '@/lib/query-client';

export default function FavouritesScreen() {
  const { user, refreshUser } = useAuth();
  const { showConfirm, showAlert, modalProps } = useAppModal();
  const [busy, setBusy] = useState<string | null>(null);
  const list = user?.favourites ?? [];

  const remove = (id: string, label: string) =>
    showConfirm('Remove place?', `Remove “${label}” from your saved places?`, async () => {
      setBusy(id);
      try {
        await apiRequest('DELETE', `/api/me/favourites/${id}`);
        await refreshUser();
      } catch (e: any) {
        showAlert('Could not remove', e.message || 'Please try again');
      } finally {
        setBusy(null);
      }
    }, 'Remove', true);

  return (
    <Screen title="Favourite places">
      {list.length === 0 ? (
        <Empty
          icon="heart-outline"
          title="No saved places yet"
          text="Pick a destination on the home screen and tap the star to save it. Saved places appear there for one-tap booking."
        />
      ) : (
        <Card>
          {list.map((f, i) => (
            <MenuRow
              key={f.id}
              icon="location-outline"
              title={f.label}
              subtitle={f.address}
              right={<Text style={{ color: '#FF3B30', fontFamily: 'Inter_500Medium' }}>{busy === f.id ? '…' : 'Remove'}</Text>}
              onPress={() => remove(f.id, f.label)}
              last={i === list.length - 1}
            />
          ))}
        </Card>
      )}
      <AppModal {...modalProps} />
    </Screen>
  );
}
