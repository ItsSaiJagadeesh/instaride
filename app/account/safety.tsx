/* InstaRide: a fork of RideFlow (GPL-3.0-or-later). Safety tips and the emergency contact. */
import React, { useState } from 'react';
import { Text, Linking, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Screen, Card, SectionLabel, Field, PrimaryButton } from '@/components/ui';
import AppModal, { useAppModal } from '@/components/AppModal';
import { useAuth } from '@/lib/auth-context';
import { apiRequest } from '@/lib/query-client';
import Colors from '@/constants/colors';

const TIPS = [
  ['key-outline', 'Start code', 'Riders get a 4-digit code. Give it to the driver only when you meet, so the wrong vehicle cannot start your trip.'],
  ['car-outline', 'Check the vehicle', 'Before you get in, check the vehicle number matches the one in the app.'],
  ['share-social-outline', 'Share your trip', 'During a ride, tap Share trip to send a live tracking link to someone you trust.'],
  ['alert-circle-outline', 'SOS', 'During a ride, tap SOS to alert our team. In an emergency call 112 first.'],
] as const;

export default function SafetyScreen() {
  const { user, refreshUser } = useAuth();
  const { showAlert, modalProps } = useAppModal();
  const [name, setName] = useState(user?.emergencyContact?.name ?? '');
  const [phone, setPhone] = useState(user?.emergencyContact?.phone ?? '');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await apiRequest('PUT', '/api/me/emergency-contact', { name: name.trim(), phone: phone.trim() });
      await refreshUser();
      showAlert('Saved', 'We will offer to message this person when you use SOS.');
    } catch (e: any) {
      showAlert('Could not save', e.message || 'Please check the number and try again');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setSaving(true);
    try {
      await apiRequest('DELETE', '/api/me/emergency-contact');
      await refreshUser();
      setName('');
      setPhone('');
    } catch (e: any) {
      showAlert('Could not remove', e.message || 'Please try again');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen title="Safety">
      <Card>
        {TIPS.map(([icon, title, text], i) => (
          <View key={title} style={{ flexDirection: 'row', gap: 12, padding: 14, borderBottomWidth: i < TIPS.length - 1 ? 0.5 : 0, borderBottomColor: Colors.border }}>
            <Ionicons name={icon as any} size={22} color={Colors.primaryDark} style={{ marginTop: 2 }} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 15, color: Colors.text }}>{title}</Text>
              <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 13, color: Colors.textLight, lineHeight: 19, marginTop: 2 }}>{text}</Text>
            </View>
          </View>
        ))}
      </Card>

      <SectionLabel>Emergency contact</SectionLabel>
      <Field label="Name" value={name} onChangeText={setName} autoCapitalize="words" maxLength={60} />
      <Field label="Mobile number" value={phone} onChangeText={setPhone} keyboardType="phone-pad" maxLength={14} hint="Used only to pre-fill an SOS message from your own phone. We do not message this person ourselves." />
      <PrimaryButton title="Save contact" onPress={save} loading={saving} disabled={name.trim().length < 2 || phone.trim().length < 10} />
      {user?.emergencyContact ? <View style={{ marginTop: 10 }}><PrimaryButton title="Remove contact" onPress={remove} variant="ghost" disabled={saving} /></View> : null}

      <SectionLabel>In an emergency</SectionLabel>
      <PrimaryButton title="Call 112" onPress={() => Linking.openURL('tel:112')} variant="danger" />
      <AppModal {...modalProps} />
    </Screen>
  );
}
