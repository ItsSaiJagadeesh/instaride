/* InstaRide: a fork of RideFlow (GPL-3.0-or-later). InstaRider profile tab. */
import React from 'react';
import { router } from 'expo-router';
import { Screen, Card, MenuRow, SectionLabel } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import ProfileHeader from '@/components/ProfileHeader';

export default function ProfileTab() {
  const { user } = useAuth();
  return (
    <Screen title="Profile" back={false}>
      <ProfileHeader />

      <SectionLabel>Your details</SectionLabel>
      <Card>
        <MenuRow icon="person-outline" title="Edit profile" subtitle={user?.email ? `${user.fullName} · ${user.email}` : 'Name, email and gender'} onPress={() => router.push('/account/edit-profile')} />
        <MenuRow icon="call-outline" title="Mobile number" subtitle={user?.phone} onPress={() => router.push('/account/change-phone')} />
        <MenuRow icon="star-outline" title="My reviews" subtitle="What drivers said about you" onPress={() => router.push('/account/my-reviews')} last />
      </Card>

      <SectionLabel>Your places and safety</SectionLabel>
      <Card>
        <MenuRow icon="heart-outline" title="Favourite places" subtitle={`${user?.favourites?.length ?? 0} saved`} onPress={() => router.push('/account/favourites')} />
        <MenuRow icon="shield-checkmark-outline" title="Safety" subtitle={user?.emergencyContact ? `Emergency contact: ${user.emergencyContact.name}` : 'Add an emergency contact'} onPress={() => router.push('/account/safety')} last />
      </Card>

      <SectionLabel>More</SectionLabel>
      <Card>
        <MenuRow icon="notifications-outline" title="Notifications" onPress={() => router.push('/account/notifications')} />
        <MenuRow icon="wallet-outline" title="Payment" subtitle="Cash" onPress={() => router.push('/account/payment')} />
        <MenuRow icon="help-circle-outline" title="Help" onPress={() => router.push('/account/help')} />
        <MenuRow icon="settings-outline" title="Settings" onPress={() => router.push('/account/settings')} />
        <MenuRow icon="information-circle-outline" title="About" onPress={() => router.push('/account/about')} last />
      </Card>
    </Screen>
  );
}
