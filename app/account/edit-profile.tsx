/* InstaRide: a fork of RideFlow (GPL-3.0-or-later). */
import React, { useState } from 'react';
import { router } from 'expo-router';
import { Screen, Field, PrimaryButton } from '@/components/ui';
import AppModal, { useAppModal } from '@/components/AppModal';
import { useAuth } from '@/lib/auth-context';
import { apiRequest } from '@/lib/query-client';

export default function EditProfileScreen() {
  const { user, refreshUser } = useAuth();
  const { showAlert, modalProps } = useAppModal();
  const [name, setName] = useState(user?.fullName ?? '');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await apiRequest('PUT', '/api/me', { fullName: name.trim() });
      await refreshUser();
      router.back();
    } catch (e: any) {
      showAlert('Could not save', e.message || 'Please try again');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen title="Edit profile">
      <Field label="Full name" value={name} onChangeText={setName} autoCapitalize="words" maxLength={80} />
      <Field
        label="Mobile number"
        value={user?.phone ?? ''}
        editable={false}
        hint="Your number is how you sign in. Changing it is not available yet."
      />
      <PrimaryButton title="Save" onPress={save} loading={saving} disabled={name.trim().length < 2 || name.trim() === user?.fullName} />
      <AppModal {...modalProps} />
    </Screen>
  );
}
