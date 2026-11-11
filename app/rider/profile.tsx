/* InstaRide: a fork of RideFlow (GPL-3.0-or-later). InstaRider profile tab. */
import React from 'react';
import { View, Text } from 'react-native';
import { router } from 'expo-router';
import { Screen, Card, MenuRow, SectionLabel } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import Colors from '@/constants/colors';

export default function ProfileTab() {
  const { user } = useAuth();
  const initial = (user?.fullName || '?').trim().charAt(0).toUpperCase();
  return (
    <Screen title="Profile" back={false}>
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16 }}>
          <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontFamily: 'Inter_700Bold', fontSize: 24, color: Colors.secondary }}>{initial}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 18, color: Colors.text }}>{user?.fullName}</Text>
            <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 14, color: Colors.textLight }}>{user?.phone}</Text>
          </View>
        </View>
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
