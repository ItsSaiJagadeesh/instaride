/*
 * InstaRide: a fork of RideFlow (GPL-3.0-or-later).
 * Shown on the driver's active-ride screen: the rider's name, mobile number and pickup, with Call and WhatsApp buttons.
 * The details come from a server route that only the driver assigned to this live ride can use, so if the ride is cancelled,
 * handed to another driver or finished, the server refuses and this card disappears.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/colors';
import AppModal, { useAppModal } from '@/components/AppModal';
import { apiRequest } from '@/lib/query-client';
import { telUrl, whatsappAppUrl, whatsappWebUrl, whatsappMessage } from '@/lib/rider-contact-core';
import type { RiderContact } from '@shared/schema';

export default function RiderContactCard({ rideId, status }: { rideId: string; status: string }) {
  const [info, setInfo] = useState<RiderContact | null>(null);
  const { showAlert, modalProps } = useAppModal();

  useEffect(() => {
    let cancelled = false;
    setInfo(null);
    apiRequest('GET', `/api/rides/${rideId}/rider-contact`)
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setInfo(d); })
      .catch(() => { if (!cancelled) setInfo(null); }); // refused: the ride is no longer this driver's
    return () => { cancelled = true; };
  }, [rideId, status]);

  if (!info) return null;

  const call = () => {
    Linking.openURL(telUrl(info.phone)).catch(() => showAlert('Cannot open the phone', `Please call ${info.phone} yourself.`));
  };

  const whatsapp = async () => {
    const text = whatsappMessage(info.greeting);
    try {
      await Linking.openURL(whatsappAppUrl(info.phone, text));
    } catch {
      try {
        await Linking.openURL(whatsappWebUrl(info.phone, text));
      } catch {
        showAlert('WhatsApp is not available', 'WhatsApp could not be opened on this phone. You can call the rider instead.');
      }
    }
  };

  return (
    <View style={styles.card} accessibilityLabel="Rider contact details">
      <View style={styles.row}>
        <Ionicons name="person-circle" size={34} color={Colors.primary} />
        <View style={styles.who}>
          <Text style={styles.name} numberOfLines={1}>{info.name}</Text>
          <Text style={styles.phone}>+91 {info.phone}</Text>
        </View>
      </View>
      <View style={styles.buttons}>
        <Pressable
          style={({ pressed }) => [styles.btn, styles.callBtn, pressed && styles.pressed]}
          onPress={call}
          accessibilityLabel="Call the rider"
        >
          <Ionicons name="call" size={18} color="#FFFFFF" />
          <Text style={styles.btnText}>Call</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.btn, styles.waBtn, pressed && styles.pressed]}
          onPress={whatsapp}
          accessibilityLabel="Message the rider on WhatsApp"
        >
          <Ionicons name="logo-whatsapp" size={18} color="#FFFFFF" />
          <Text style={styles.btnText}>WhatsApp</Text>
        </Pressable>
      </View>
      <AppModal {...modalProps} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: 'rgba(120,120,128,0.12)', borderRadius: 14, padding: 12, marginTop: 10, marginBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  who: { flex: 1 },
  name: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: Colors.text },
  phone: { fontSize: 14, fontFamily: 'Inter_500Medium', color: Colors.textLight, marginTop: 1 },
  buttons: { flexDirection: 'row', gap: 10, marginTop: 10 },
  btn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12, borderRadius: 12 },
  callBtn: { backgroundColor: '#1D7FE8' },
  waBtn: { backgroundColor: '#25A244' },
  btnText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: '#FFFFFF' },
  pressed: { opacity: 0.8 },
});
