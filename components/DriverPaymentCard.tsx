/* InstaRide: a fork of RideFlow (GPL-3.0-or-later).
 * The driver's payment page after a trip: the amount, a UPI QR code with that exact amount filled in (so the rider scans it and types nothing),
 * and two buttons to confirm the money was collected, in cash or by UPI. InstaRide never holds the money, and UPI cannot tell us when a payment
 * arrives, so the driver's confirmation is what ends the payment step. */
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator, StyleSheet, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/colors';
import { apiRequest } from '@/lib/query-client';
import { useAuth } from '@/lib/auth-context';
import { formatINR } from '@/lib/format';
import AppModal, { useAppModal } from '@/components/AppModal';
import UpiQr from '@/components/UpiQr';
import { UPI_ID_RE, type PaymentInfo } from '@shared/schema';

export default function DriverPaymentCard({ rideId, onCollected }: { rideId: string; onCollected: (info: PaymentInfo) => void }) {
  const { user, refreshUser } = useAuth();
  const { showConfirm, showAlert, modalProps } = useAppModal();
  const { height } = useWindowDimensions();
  const qrSize = Math.round(Math.max(200, Math.min(240, height * 0.32))); // big enough to scan, smaller on short screens so the buttons stay near
  const [info, setInfo] = useState<PaymentInfo | null>(null);
  const [error, setError] = useState('');
  const [upi, setUpi] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiRequest('GET', `/api/rides/${rideId}/payment`);
      setInfo((await res.json()) as PaymentInfo);
      setError('');
    } catch {
      setError('Could not load the payment. Please check your connection.');
    }
  }, [rideId]);

  useEffect(() => {
    void load();
    const t = setInterval(load, 4000); // also shows when the rider taps "I have paid"
    return () => clearInterval(t);
  }, [load]);

  const collect = (method: 'cash' | 'upi') => {
    if (!info) return;
    showConfirm(
      'Payment received?',
      `Mark ${formatINR(info.total)} as collected ${method === 'cash' ? 'in cash' : 'by UPI'}? You cannot undo this.`,
      async () => {
        setBusy(method);
        try {
          const res = await apiRequest('PUT', `/api/rides/${rideId}/payment/collect`, { method });
          onCollected((await res.json()) as PaymentInfo);
        } catch (e: any) {
          showAlert('Could not save', e.message || 'Please try again');
        } finally {
          setBusy(null);
        }
      },
      'Yes, collected',
    );
  };

  const saveUpi = async () => {
    setBusy('upi-id');
    try {
      await apiRequest('PUT', '/api/me', { fullName: user?.fullName, upiId: upi.trim() });
      await refreshUser();
      await load();
    } catch (e: any) {
      showAlert('Could not save', e.message || 'Please try again');
    } finally {
      setBusy(null);
    }
  };

  if (error && !info) return <Text style={styles.error}>{error}</Text>;
  if (!info) return <ActivityIndicator style={{ marginVertical: 30 }} color={Colors.primary} />;

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Collect payment</Text>
      <Text style={styles.amount} accessibilityLabel="Amount to collect">{formatINR(info.total)}</Text>
      {info.tip > 0 && <Text style={styles.tipNote} accessibilityLabel="Fare and tip">Fare {formatINR(info.amount)} + tip {formatINR(info.tip)}. The whole tip is yours.</Text>}

      {!!info.riderClaimedAt && (
        <View style={styles.claim} accessibilityLabel="The rider says they have paid">
          <Ionicons name="checkmark-circle" size={18} color={Colors.success} />
          <Text style={styles.claimText}>The rider says they have paid. Please check, then confirm below.</Text>
        </View>
      )}

      {info.upiUrl ? (
        <View style={styles.qrBox}>
          <UpiQr value={info.upiUrl} size={qrSize} label="UPI QR code" />
          <Text style={styles.hint}>Ask the rider to scan this with any UPI app. The amount is already filled in.</Text>
        </View>
      ) : (
        <View style={styles.addUpi}>
          <Text style={styles.hint}>Add your UPI ID to show a QR code the rider can scan. You can still collect cash below.</Text>
          <TextInput
            style={styles.input}
            placeholder="yourname@bank"
            placeholderTextColor={Colors.textLight}
            value={upi}
            onChangeText={setUpi}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            accessibilityLabel="Your UPI ID"
          />
          <Pressable
            onPress={saveUpi}
            disabled={!UPI_ID_RE.test(upi.trim()) || busy === 'upi-id'}
            accessibilityLabel="Save UPI ID"
            style={({ pressed }) => [styles.saveBtn, (!UPI_ID_RE.test(upi.trim()) || busy === 'upi-id') && styles.disabled, pressed && { opacity: 0.8 }]}
          >
            {busy === 'upi-id' ? <ActivityIndicator size="small" color={Colors.secondary} /> : <Text style={styles.saveBtnText}>Save UPI ID and show QR</Text>}
          </Pressable>
        </View>
      )}

      <View style={styles.btnRow}>
        <Pressable
          onPress={() => collect('cash')}
          disabled={!!busy}
          accessibilityLabel="Collected in cash"
          style={({ pressed }) => [styles.collectBtn, styles.cashBtn, !!busy && styles.disabled, pressed && { opacity: 0.85 }]}
        >
          <Ionicons name="cash-outline" size={20} color={Colors.secondary} />
          <Text style={styles.collectText}>Collected in cash</Text>
        </Pressable>
        <Pressable
          onPress={() => collect('upi')}
          disabled={!!busy}
          accessibilityLabel="Collected by UPI"
          style={({ pressed }) => [styles.collectBtn, styles.upiBtn, !!busy && styles.disabled, pressed && { opacity: 0.85 }]}
        >
          <Ionicons name="phone-portrait-outline" size={20} color={Colors.secondary} />
          <Text style={styles.collectText}>Collected by UPI</Text>
        </Pressable>
      </View>
      <AppModal {...modalProps} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', paddingBottom: 8 },
  title: { fontSize: 18, fontFamily: 'Inter_700Bold', color: Colors.text, marginBottom: 2 },
  amount: { fontSize: 40, fontFamily: 'Inter_700Bold', color: Colors.primary, marginBottom: 10 },
  tipNote: { fontSize: 13, fontFamily: 'Inter_500Medium', color: Colors.success, marginBottom: 8, textAlign: 'center' },
  claim: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#E8FBF5', borderRadius: 12, padding: 10, marginBottom: 10, alignSelf: 'stretch' },
  claimText: { flex: 1, fontSize: 13, fontFamily: 'Inter_500Medium', color: Colors.text },
  qrBox: { alignItems: 'center', gap: 8, marginBottom: 12 },
  hint: { fontSize: 13, fontFamily: 'Inter_400Regular', color: Colors.textLight, textAlign: 'center' },
  addUpi: { alignSelf: 'stretch', gap: 8, marginBottom: 12 },
  input: { backgroundColor: Colors.background, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 12, fontSize: 15, fontFamily: 'Inter_400Regular', color: Colors.text },
  saveBtn: { backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 12, alignItems: 'center' },
  saveBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: Colors.secondary },
  btnRow: { flexDirection: 'row', gap: 10, alignSelf: 'stretch' },
  collectBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 14, paddingVertical: 14 },
  cashBtn: { backgroundColor: Colors.primary },
  upiBtn: { backgroundColor: '#FFB800' },
  collectText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: Colors.secondary },
  disabled: { opacity: 0.5 },
  error: { fontSize: 14, fontFamily: 'Inter_500Medium', color: Colors.error, textAlign: 'center', marginVertical: 20 },
});
