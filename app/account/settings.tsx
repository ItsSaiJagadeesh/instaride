/* InstaRide: a fork of RideFlow (GPL-3.0-or-later). Settings hub, shared by InstaRider and InstaDriver. */
import React from 'react';
import { router } from 'expo-router';
import { Screen, Card, MenuRow, SectionLabel } from '@/components/ui';
import AppModal, { useAppModal } from '@/components/AppModal';
import { useAuth } from '@/lib/auth-context';
import { goToWelcome } from '@/lib/nav';

export default function SettingsScreen() {
  const { user, logout } = useAuth();
  const { showConfirm, modalProps } = useAppModal();
  return (
    <Screen title="Settings">
      <SectionLabel>Account</SectionLabel>
      <Card>
        <MenuRow icon="person-outline" title="Edit profile" subtitle={`${user?.fullName ?? ''} · ${user?.phone ?? ''}`} onPress={() => router.push('/account/edit-profile')} last />
      </Card>

      <SectionLabel>Safety and help</SectionLabel>
      <Card>
        <MenuRow icon="shield-checkmark-outline" title="Safety and emergency contact" onPress={() => router.push('/account/safety')} />
        <MenuRow icon="help-circle-outline" title="Help" onPress={() => router.push('/account/help')} />
        <MenuRow icon="information-circle-outline" title="About, privacy and terms" onPress={() => router.push('/account/about')} last />
      </Card>

      <SectionLabel>Sign out</SectionLabel>
      <Card>
        <MenuRow
          icon="log-out-outline"
          title="Log out"
          onPress={() => showConfirm('Log out?', 'You will need a new code to sign in again.', () => { void logout(); goToWelcome(); }, 'Log out', true)}
        />
        <MenuRow icon="trash-outline" title="Delete account" subtitle="Permanently remove your account and personal details" danger onPress={() => router.push('/account/delete-account')} last />
      </Card>
      <AppModal {...modalProps} />
    </Screen>
  );
}
