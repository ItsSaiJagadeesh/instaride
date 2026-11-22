/* InstaRide: a fork of RideFlow (GPL-3.0-or-later).
 * The rider's payment page after a trip: the amount, a button that opens the rider's own UPI app with the driver and the exact amount filled in,
 * and a note that the driver's QR code can be scanned instead. When the driver confirms the payment, onCollected is called and the rider
 * moves on to the review. */
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, ActivityIndicator, Linking, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/colors';
import { apiRequest } from '@/lib/query-client';
import { formatINR } from '@/lib/format';
import AppModal, { useAppModal } from '@/components/AppModal';
import type { PaymentInfo } from '@shared/schema';

export default function RiderPaymentCard({ rideId, onCollected }: { rideId: string; onCollected: (info: PaymentInfo | null) => void }) {
  const { showAlert, modalProps } = useAppModal();
  const [info, setInfo] = useState<PaymentInfo | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiRequest('GET', `/api/rides/${rideId}/payment`);
      const data = (await res.json()) as PaymentInfo;
      setInfo(data);
      if (data.status === 'collected') onCollected(data);
    } catch (e: any) {
      // A trip finished before payments existed has no payment page: go straight on.
      if (String(e?.message || '').includes('No payment')) onCollected(null);
    }
  }, [rideId, onCollected]);

  useEffect(() => {
    void load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [load]);

  const openUpi = async () => {
    if (!info?.upiUrl) return;
    try {
      await Linking.openURL(info.upiUrl);
    } catch {
      showAlert('No UPI app found', "We could not open a UPI app. Please scan your driver's QR code, or pay in cash.");
    }
  };

  const claim = async () => {
    setBusy(true);
    try {
      const res = await apiRequest('PUT', `/api/rides/${rideId}/payment/claim`);
      setInfo((await res.json()) as PaymentInfo);
    } catch (e: any) {
      showAlert('Could not send', e.message || 'Please try again');
    } finally {
      setBusy(false);
    }
  };

  if (!info) return <ActivityIndicator style={{ marginVertical: 30 }} color={Colors.primary} />;
  const driver = info.driverName || 'your driver';

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Pay {driver}</Text>
      <Text style={styles.amount} accessibilityLabel="Amount to pay">{formatINR(info.amount)}</Text>

      {info.upiUrl ? (
        <>
          <Pressable
            onPress={openUpi}
            accessibilityLabel="Pay with a UPI app"
            style={({ pressed }) => [styles.payBtn, pressed && { opacity: 0.85 }]}
          >
            <Ionicons name="phone-portrait-outline" size={20} color={Colors.secondary} />
            <Text style={styles.payBtnText}>Pay with a UPI app</Text>
          </Pressable>
          <Text style={styles.hint}>Or scan the QR code on your driver's phone with any UPI app. The amount is already filled in.</Text>
        </>
      ) : (
        <Text style={styles.hint}>Please pay {driver} in cash.</Text>
      )}
      <Text style={styles.hint}>Paying cash? Hand it to {driver}.</Text>

      {info.riderClaimedAt ? (
        <View style={styles.waiting} accessibilityLabel="Waiting for the driver to confirm">
          <ActivityIndicator size="small" color={Colors.primary} />
          <Text style={styles.waitingText}>Waiting for {driver} to confirm the payment…</Text>
        </View>
      ) : (
        <Pressable
          onPress={claim}
          disabled={busy}
          accessibilityLabel="I have paid"
          style={({ pressed }) => [styles.paidBtn, busy && { opacity: 0.5 }, pressed && { opacity: 0.85 }]}
        >
          <Ionicons name="checkmark-circle-outline" size={20} color={Colors.text} />
          <Text style={styles.paidBtnText}>I have paid</Text>
        </Pressable>
      )}
      <AppModal {...modalProps} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', paddingBottom: 8, gap: 8 },
  title: { fontSize: 18, fontFamily: 'Inter_700Bold', color: Colors.text },
  amount: { fontSize: 40, fontFamily: 'Inter_700Bold', color: Colors.primary, marginBottom: 4 },
  payBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 20, alignSelf: 'stretch' },
  payBtnText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: Colors.secondary },
  hint: { fontSize: 13, fontFamily: 'Inter_400Regular', color: Colors.textLight, textAlign: 'center' },
  paidBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 14, borderWidth: 1, borderColor: Colors.border, paddingVertical: 12, paddingHorizontal: 20, alignSelf: 'stretch', marginTop: 4 },
  paidBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: Colors.text },
  waiting: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6 },
  waitingText: { fontSize: 14, fontFamily: 'Inter_500Medium', color: Colors.text },
});
