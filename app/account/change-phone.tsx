/* InstaRide: a fork of RideFlow (GPL-3.0-or-later).
 * Change the mobile number. The person is already signed in, and must prove the NEW number with a code sent to it.
 * The account, its rides and its reviews stay the same: only the number you sign in with changes. */
import React, { useState } from 'react';
import { Text } from 'react-native';
import { router } from 'expo-router';
import { Screen, Field, PrimaryButton } from '@/components/ui';
import AppModal, { useAppModal } from '@/components/AppModal';
import { useAuth } from '@/lib/auth-context';
import { apiRequest } from '@/lib/query-client';
import { requestPhoneProof, finishPhoneProof } from '@/lib/phone-proof';
import Colors from '@/constants/colors';

export default function ChangePhoneScreen() {
  const { user, refreshUser } = useAuth();
  const { showAlert, modalProps } = useAppModal();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'number' | 'code'>('number');
  const [busy, setBusy] = useState(false);
  const ten = phone.replace(/\D/g, '').slice(-10);
  const valid = /^[6-9]\d{9}$/.test(ten);

  const sendCode = async () => {
    setBusy(true);
    try {
      await requestPhoneProof('/api/me/phone/request', ten, { phone: ten });
      setStep('code');
    } catch (e: any) {
      showAlert('Could not send the code', e.message || 'Please try again');
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    setBusy(true);
    try {
      const proof = await finishPhoneProof(code);
      await apiRequest('POST', '/api/me/phone/verify', { phone: ten, ...proof });
      await refreshUser();
      // Go back only after the person has read the message and tapped OK.
      showAlert('Number changed', `From now on, sign in with ${ten}. Your trips and reviews stay with you.`, [{ label: 'OK', onPress: () => router.back() }]);
    } catch (e: any) {
      showAlert('Could not change the number', e.message || 'Please try again');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title="Change mobile number">
      <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 14, color: Colors.textLight, marginBottom: 12 }}>
        Your number is how you sign in. We will send a code to the new number to check that it is yours.
      </Text>
      <Field label="Current number" value={user?.phone ?? ''} editable={false} />
      <Field
        label="New mobile number"
        value={phone}
        onChangeText={(t: string) => { setPhone(t.replace(/\D/g, '').slice(0, 10)); if (step === 'code') setStep('number'); }}
        keyboardType="number-pad"
        maxLength={10}
        placeholder="10-digit mobile number"
        accessibilityLabel="New mobile number"
      />
      {step === 'number' ? (
        <PrimaryButton title="Send code" onPress={sendCode} loading={busy} disabled={!valid || ten === user?.phone} />
      ) : (
        <>
          <Field
            label="Code sent to the new number"
            value={code}
            onChangeText={(t: string) => setCode(t.replace(/\D/g, '').slice(0, 6))}
            keyboardType="number-pad"
            maxLength={6}
            placeholder="6-digit code"
            accessibilityLabel="Code for the new number"
          />
          <PrimaryButton title="Change my number" onPress={confirm} loading={busy} disabled={code.length !== 6} />
        </>
      )}
      <AppModal {...modalProps} />
    </Screen>
  );
}
