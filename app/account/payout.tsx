/* InstaRide: a fork of RideFlow (GPL-3.0-or-later). A driver's payout details: the UPI ID riders pay (shown as a QR code) and a bank account.
 * The full bank account number is saved encrypted and is never shown again: this screen only ever shows the last 4 digits. */
import React, { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { Screen, Card, Field, PrimaryButton, SectionLabel } from '@/components/ui';
import AppModal, { useAppModal } from '@/components/AppModal';
import { useAuth } from '@/lib/auth-context';
import { apiRequest } from '@/lib/query-client';
import Colors from '@/constants/colors';
import { UPI_ID_RE, bankDetailsSchema } from '@shared/schema';

export default function PayoutScreen() {
  const { user, refreshUser } = useAuth();
  const { showAlert, showConfirm, modalProps } = useAppModal();
  const [upi, setUpi] = useState(user?.upiId ?? '');
  const [holder, setHolder] = useState(user?.bank?.holder ?? user?.fullName ?? '');
  const [account, setAccount] = useState('');
  const [again, setAgain] = useState('');
  const [ifsc, setIfsc] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [replacing, setReplacing] = useState(false);

  if (user?.role !== 'driver') {
    return (
      <Screen title="Payout details">
        <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 14, color: Colors.textLight }}>Payout details are for drivers.</Text>
      </Screen>
    );
  }

  const upiClean = upi.trim();
  const upiChanged = upiClean !== (user.upiId ?? '');
  const upiOk = upiClean === '' || UPI_ID_RE.test(upiClean);

  const saveUpi = async () => {
    setBusy('upi');
    try {
      await apiRequest('PUT', '/api/me', { fullName: user.fullName, upiId: upiClean || null });
      await refreshUser();
      showAlert('Saved', upiClean ? 'Riders will see a QR code for this UPI ID after each trip.' : 'UPI ID removed. You can still collect cash.');
    } catch (e: any) {
      showAlert('Could not save', e.message || 'Please try again');
    } finally {
      setBusy(null);
    }
  };

  const parsed = bankDetailsSchema.safeParse({ holder, account, ifsc });
  const accountsMatch = account.length > 0 && account === again;

  const saveBank = async () => {
    setBusy('bank');
    try {
      await apiRequest('PUT', '/api/me/bank', parsed.success ? parsed.data : {});
      await refreshUser();
      setAccount(''); setAgain(''); setIfsc(''); setReplacing(false);
      showAlert('Saved', 'Your bank account is saved. The full number is stored encrypted and will not be shown again.');
    } catch (e: any) {
      showAlert('Could not save', e.message || 'Please check the details and try again');
    } finally {
      setBusy(null);
    }
  };

  const removeBank = () =>
    showConfirm('Remove bank account?', 'Your bank details will be deleted from InstaRide.', async () => {
      setBusy('remove');
      try {
        await apiRequest('DELETE', '/api/me/bank');
        await refreshUser();
      } catch (e: any) {
        showAlert('Could not remove', e.message || 'Please try again');
      } finally {
        setBusy(null);
      }
    }, 'Remove', true);

  const hasBank = !!user.bank;
  const showForm = !hasBank || replacing;

  return (
    <Screen title="Payout details">
      <SectionLabel>UPI ID (riders pay you directly)</SectionLabel>
      <Field
        label="UPI ID"
        accessibilityLabel="UPI ID"
        value={upi}
        onChangeText={setUpi}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="yourname@bank"
        maxLength={80}
        hint="After each trip the rider scans a QR code with this ID and the fare filled in. We never hold your money. Leave empty to take cash only."
      />
      {!upiOk && <Text style={{ color: Colors.error, fontFamily: 'Inter_500Medium', fontSize: 13, marginBottom: 8 }}>A UPI ID looks like yourname@bank</Text>}
      <PrimaryButton title="Save UPI ID" onPress={saveUpi} loading={busy === 'upi'} disabled={!upiChanged || !upiOk} />

      <SectionLabel>Bank account</SectionLabel>
      {hasBank && (
        <Card>
          <View style={{ padding: 16, gap: 4 }} accessibilityLabel="Saved bank account">
            <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 15, color: Colors.text }}>{user.bank!.holder}</Text>
            <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 14, color: Colors.textLight }}>Account ending {user.bank!.last4} · IFSC {user.bank!.ifsc}</Text>
            <View style={{ flexDirection: 'row', gap: 16, marginTop: 8 }}>
              <Pressable onPress={() => setReplacing((r) => !r)} accessibilityLabel="Replace bank account"><Text style={{ fontFamily: 'Inter_600SemiBold', color: Colors.primary }}>{replacing ? 'Cancel' : 'Replace'}</Text></Pressable>
              <Pressable onPress={removeBank} accessibilityLabel="Remove bank account"><Text style={{ fontFamily: 'Inter_600SemiBold', color: Colors.error }}>Remove</Text></Pressable>
            </View>
          </View>
        </Card>
      )}
      {showForm && (
        <>
          <Field label="Name on the account" value={holder} onChangeText={setHolder} autoCapitalize="words" maxLength={80} accessibilityLabel="Name on the account" />
          <Field label="Account number" value={account} onChangeText={(t: string) => setAccount(t.replace(/\D/g, '').slice(0, 18))} keyboardType="number-pad" maxLength={18} placeholder="9 to 18 digits" accessibilityLabel="Account number" />
          <Field label="Account number again" value={again} onChangeText={(t: string) => setAgain(t.replace(/\D/g, '').slice(0, 18))} keyboardType="number-pad" maxLength={18} placeholder="Type it again to be sure" accessibilityLabel="Account number again" />
          <Field label="IFSC code" value={ifsc} onChangeText={(t: string) => setIfsc(t.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 11))} autoCapitalize="characters" maxLength={11} placeholder="for example SBIN0001234" accessibilityLabel="IFSC code" />
          {account.length > 0 && again.length > 0 && !accountsMatch && <Text style={{ color: Colors.error, fontFamily: 'Inter_500Medium', fontSize: 13, marginBottom: 8 }}>The two account numbers do not match</Text>}
          <PrimaryButton title="Save bank account" onPress={saveBank} loading={busy === 'bank'} disabled={!parsed.success || !accountsMatch} />
        </>
      )}
      <AppModal {...modalProps} />
    </Screen>
  );
}
