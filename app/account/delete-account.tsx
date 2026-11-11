/* InstaRide: a fork of RideFlow (GPL-3.0-or-later). Delete your own account, confirmed with a code sent to your phone. */
import React, { useEffect, useState } from 'react';
import { Text, Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Screen, Card, Field, PrimaryButton, SectionLabel } from '@/components/ui';
import AppModal, { useAppModal } from '@/components/AppModal';
import { useAuth } from '@/lib/auth-context';
import { goToWelcome } from '@/lib/nav';
import { apiRequest } from '@/lib/query-client';
import Colors from '@/constants/colors';

const REASONS = ['I do not need the service', 'Poor app experience', 'Worried about my privacy', 'Moved to another app', 'Changed my phone number'];

export default function DeleteAccountScreen() {
  const { user, logout } = useAuth();
  const { showAlert, showConfirm, modalProps } = useAppModal();
  const [reason, setReason] = useState<string | null>(null);
  const [other, setOther] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (countdown <= 0) return;
    const t = setTimeout(() => setCountdown(countdown - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  const sendCode = async () => {
    setBusy(true);
    try {
      const res = await apiRequest('POST', '/api/me/otp');
      const out = await res.json();
      setSent(true);
      setCountdown(out.resendAfterSeconds || 30);
    } catch (e: any) {
      showAlert('Could not send the code', e.message || 'Please try again');
    } finally {
      setBusy(false);
    }
  };

  const go = () =>
    showConfirm(
      'Delete your account?',
      user?.role === 'driver'
        ? 'Your documents and personal details will be removed and you will not be able to sign in again with this account. This cannot be undone.'
        : 'Your saved places and personal details will be removed and you will not be able to sign in again with this account. This cannot be undone.',
      async () => {
        setBusy(true);
        try {
          await apiRequest('DELETE', '/api/me', { otp: code, reason: [reason, other.trim()].filter(Boolean).join(': ').slice(0, 200) || undefined });
          await logout();
          goToWelcome();
        } catch (e: any) {
          showAlert('Could not delete', e.message || 'Please try again');
        } finally {
          setBusy(false);
        }
      },
      'Delete',
      true,
    );

  return (
    <Screen title="Delete account">
      <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 14, color: Colors.textLight, lineHeight: 20 }}>
        We are sorry to see you go. Tell us why (optional), then confirm with a code we text to your number. Past trips stay in our records for fee and safety reasons, without your name.
      </Text>
      <SectionLabel>Reason</SectionLabel>
      <Card>
        {REASONS.map((r, i) => (
          <Pressable key={r} onPress={() => setReason(reason === r ? null : r)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderBottomWidth: i < REASONS.length - 1 ? 0.5 : 0, borderBottomColor: Colors.border }}>
            <Ionicons name={reason === r ? 'radio-button-on' : 'radio-button-off'} size={22} color={reason === r ? Colors.primaryDark : Colors.textLight} />
            <Text style={{ flex: 1, fontFamily: 'Inter_400Regular', fontSize: 15, color: Colors.text }}>{r}</Text>
          </Pressable>
        ))}
      </Card>
      <View style={{ height: 14 }} />
      <Field label="Anything else? (optional)" value={other} onChangeText={setOther} maxLength={150} />

      {!sent ? (
        <PrimaryButton title="Text me a code" onPress={sendCode} loading={busy} variant="ghost" />
      ) : (
        <>
          <Field label={`Code sent to ${user?.phone ?? 'your number'}`} value={code} onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, 6))} placeholder="6-digit code" keyboardType="number-pad" maxLength={6} />
          <Pressable onPress={sendCode} disabled={countdown > 0 || busy} style={{ marginBottom: 14 }}>
            <Text style={{ fontFamily: 'Inter_500Medium', fontSize: 14, color: countdown > 0 ? Colors.textLight : Colors.primaryDark }}>
              {countdown > 0 ? `Send again in ${countdown}s` : 'Send the code again'}
            </Text>
          </Pressable>
          <PrimaryButton title="Delete my account" variant="danger" onPress={go} loading={busy} disabled={code.length !== 6} />
        </>
      )}
      <AppModal {...modalProps} />
    </Screen>
  );
}
