/* InstaRide: a fork of RideFlow (GPL-3.0-or-later).
 * The rider's payment page after a trip: the amount, a button that opens the rider's own UPI app with the driver and the exact amount filled in,
 * and a note that the driver's QR code can be scanned instead. When the driver confirms the payment, onCollected is called and the rider
 * moves on to the review. */
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator, Linking, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/colors';
import { apiRequest } from '@/lib/query-client';
import { formatINR } from '@/lib/format';
import AppModal, { useAppModal } from '@/components/AppModal';
import { MAX_TIP, type PaymentInfo } from '@shared/schema';

const TIP_CHOICES = [10, 20, 50, 100];

export default function RiderPaymentCard({ rideId, onCollected }: { rideId: string; onCollected: (info: PaymentInfo | null) => void }) {
  const { showAlert, modalProps } = useAppModal();
  const [info, setInfo] = useState<PaymentInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [tipOpen, setTipOpen] = useState(false);
  const [custom, setCustom] = useState('');
  const [tipBusy, setTipBusy] = useState(false);

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

  // A thank-you for the driver, added to the amount the QR code and the UPI link ask for. Tapping the chosen amount again removes it.
  const setTip = async (amount: number) => {
    setTipBusy(true);
    try {
      const res = await apiRequest('PUT', `/api/rides/${rideId}/payment/tip`, { amount });
      setInfo((await res.json()) as PaymentInfo);
    } catch (e: any) {
      showAlert('Could not add the tip', e.message || 'Please try again');
    } finally {
      setTipBusy(false);
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
      <Text style={styles.amount} accessibilityLabel="Amount to pay">{formatINR(info.total)}</Text>
      {info.tip > 0 && <Text style={styles.hint} accessibilityLabel="Fare and tip">Fare {formatINR(info.amount)} + tip {formatINR(info.tip)}</Text>}

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

      {!info.riderClaimedAt && (
        <View style={styles.tipBox}>
          <Pressable onPress={() => setTipOpen((o) => !o)} accessibilityLabel="Add a tip" style={styles.tipToggle}>
            <Ionicons name="heart-outline" size={16} color={Colors.accent} />
            <Text style={styles.tipToggleText}>{info.tip > 0 ? `Tip ${formatINR(info.tip)} added · change` : `Add a tip for ${driver}`}</Text>
          </Pressable>
          {tipOpen && (
            <>
              <View style={styles.tipRow}>
                {TIP_CHOICES.map((n) => {
                  const on = info.tip === n;
                  return (
                    <Pressable
                      key={n}
                      accessibilityLabel={`Tip ${n} rupees`}
                      accessibilityState={{ selected: on }}
                      disabled={tipBusy}
                      onPress={() => setTip(on ? 0 : n)}
                      style={[styles.tipChip, on && styles.tipChipOn]}
                    >
                      <Text style={[styles.tipChipText, on && styles.tipChipTextOn]}>{formatINR(n)}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <View style={styles.tipRow}>
                <TextInput
                  style={styles.tipInput}
                  value={custom}
                  onChangeText={(t) => setCustom(t.replace(/\D/g, '').slice(0, 3))}
                  keyboardType="number-pad"
                  placeholder="Other amount"
                  placeholderTextColor={Colors.textLight}
                  accessibilityLabel="Other tip amount"
                />
                <Pressable
                  accessibilityLabel="Add other tip"
                  disabled={tipBusy || !(Number(custom) >= 1 && Number(custom) <= MAX_TIP)}
                  onPress={() => { setTip(Number(custom)); setCustom(''); }}
                  style={[styles.tipAdd, (tipBusy || !(Number(custom) >= 1 && Number(custom) <= MAX_TIP)) && { opacity: 0.5 }]}
                >
                  <Text style={styles.tipAddText}>Add</Text>
                </Pressable>
              </View>
              <Text style={styles.hint}>The whole tip goes to {driver}. You can add up to {formatINR(MAX_TIP)}.</Text>
            </>
          )}
        </View>
      )}

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
  tipBox: { alignSelf: 'stretch', alignItems: 'center', gap: 8, marginTop: 4 },
  tipToggle: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: 12 },
  tipToggleText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: Colors.accent },
  tipRow: { flexDirection: 'row', gap: 8, justifyContent: 'center', alignItems: 'center', flexWrap: 'wrap' },
  tipChip: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 16, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface },
  tipChipOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  tipChipText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: Colors.text },
  tipChipTextOn: { color: Colors.secondary },
  tipInput: { backgroundColor: Colors.background, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 8, fontSize: 14, fontFamily: 'Inter_400Regular', color: Colors.text, minWidth: 130 },
  tipAdd: { backgroundColor: Colors.primary, borderRadius: 12, paddingHorizontal: 18, paddingVertical: 9 },
  tipAddText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: Colors.secondary },
  waiting: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6 },
  waitingText: { fontSize: 14, fontFamily: 'Inter_500Medium', color: Colors.text },
});
