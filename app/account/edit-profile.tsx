/* InstaRide: a fork of RideFlow (GPL-3.0-or-later). */
import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { Screen, Field, PrimaryButton } from '@/components/ui';
import AppModal, { useAppModal } from '@/components/AppModal';
import { useAuth } from '@/lib/auth-context';
import { apiRequest } from '@/lib/query-client';
import Colors from '@/constants/colors';
import type { Gender } from '@shared/schema';

const GENDERS: { value: Gender | null; label: string }[] = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'other', label: 'Other' },
  { value: null, label: 'Prefer not to say' },
];

export default function EditProfileScreen() {
  const { user, refreshUser } = useAuth();
  const { showAlert, modalProps } = useAppModal();
  const [name, setName] = useState(user?.fullName ?? '');
  const [gender, setGender] = useState<Gender | null>((user?.gender as Gender | undefined) ?? null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await apiRequest('PUT', '/api/me', { fullName: name.trim(), gender });
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
      <Text style={styles.label}>Gender (optional)</Text>
      <Text style={styles.hint}>Used only so a driver can greet you properly. It is never shown to anyone.</Text>
      <View style={styles.chips}>
        {GENDERS.map((g) => (
          <Pressable
            key={g.label}
            onPress={() => setGender(g.value)}
            style={[styles.chip, gender === g.value && styles.chipOn]}
            accessibilityRole="button"
            accessibilityLabel={`Gender: ${g.label}`}
            accessibilityState={{ selected: gender === g.value }}
          >
            <Text style={[styles.chipText, gender === g.value && styles.chipTextOn]}>{g.label}</Text>
          </Pressable>
        ))}
      </View>
      <PrimaryButton
        title="Save"
        onPress={save}
        loading={saving}
        disabled={name.trim().length < 2 || (name.trim() === user?.fullName && gender === ((user?.gender as Gender | undefined) ?? null))}
      />
      <AppModal {...modalProps} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: Colors.text, marginTop: 6 },
  hint: { fontSize: 12, fontFamily: 'Inter_400Regular', color: Colors.textLight, marginTop: 2, marginBottom: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  chip: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1.5, borderColor: Colors.border },
  chipOn: { borderColor: Colors.primary, backgroundColor: 'rgba(0,179,134,0.12)' },
  chipText: { fontSize: 14, fontFamily: 'Inter_500Medium', color: Colors.text },
  chipTextOn: { color: Colors.primary, fontFamily: 'Inter_600SemiBold' },
});
