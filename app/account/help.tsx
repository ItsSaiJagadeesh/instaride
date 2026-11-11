/* InstaRide: a fork of RideFlow (GPL-3.0-or-later). Help and support contact. */
import React, { useState } from 'react';
import { Text, Pressable, View, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Screen, Card, MenuRow, SectionLabel } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { useApiGet } from '@/lib/use-api';
import Colors from '@/constants/colors';

const RIDER_FAQ: [string, string][] = [
  ['How do I pay?', 'Pay the driver in cash at the end of the trip. The fare shown before you book is what you pay, within a small limit if you change the destination.'],
  ['What is the start code?', 'A 4-digit code shown on your screen once a driver accepts. Tell it to the driver only when you meet, so they can start the trip.'],
  ['My driver is taking too long', 'You can cancel for free before the trip starts and book again.'],
  ['I left something in the vehicle', 'Contact support with the date and time of the trip and the vehicle number from My rides.'],
  ['I had a problem on a trip', 'Contact support with the trip date and time. If you feel unsafe during a ride, use SOS and call 112.'],
  ['Why can I only book inside the town?', 'The service currently runs in one area. Both pickup and drop must be inside it.'],
];
const DRIVER_FAQ: [string, string][] = [
  ['What is the platform fee?', 'A flat fee for each completed ride, shown on your home screen. You keep the rest of the fare. Cancelled rides cost nothing.'],
  ['Why can I not go online?', 'Your vehicle must be approved, your insurance and fitness dates must be valid, and unpaid fees must be under the limit. The reason is shown when you try.'],
  ['How do I pay my fees?', 'Pay the amount due to the admin, who records it. Your balance then drops.'],
  ['My insurance is expiring', 'Upload the new insurance from your home screen before it expires. You go offline automatically on expiry until it is approved.'],
  ['The rider gave a wrong code', 'You cannot start the trip without the right 4-digit code. Ask the rider to check their screen.'],
];

export default function HelpScreen() {
  const { user } = useAuth();
  const { data } = useApiGet<{ supportPhone: string; supportEmail: string }>('/api/config/public');
  const [open, setOpen] = useState<number | null>(null);
  const faq = user?.role === 'driver' ? DRIVER_FAQ : RIDER_FAQ;

  return (
    <Screen title="Help">
      <SectionLabel>Common questions</SectionLabel>
      <Card>
        {faq.map(([q, a], i) => (
          <Pressable key={q} onPress={() => setOpen(open === i ? null : i)} style={{ padding: 14, borderBottomWidth: i < faq.length - 1 ? 0.5 : 0, borderBottomColor: Colors.border }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={{ flex: 1, fontFamily: 'Inter_500Medium', fontSize: 15, color: Colors.text }}>{q}</Text>
              <Ionicons name={open === i ? 'chevron-up' : 'chevron-down'} size={18} color={Colors.textLight} />
            </View>
            {open === i ? <Text style={{ marginTop: 8, fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 20, color: Colors.textLight }}>{a}</Text> : null}
          </Pressable>
        ))}
      </Card>

      <SectionLabel>Contact support</SectionLabel>
      <Card>
        {data?.supportPhone ? <MenuRow icon="call-outline" title="Call support" subtitle={data.supportPhone} onPress={() => Linking.openURL(`tel:${data.supportPhone.replace(/\s/g, '')}`)} last={!data?.supportEmail} /> : null}
        {data?.supportEmail ? <MenuRow icon="mail-outline" title="Email support" subtitle={data.supportEmail} onPress={() => Linking.openURL(`mailto:${data.supportEmail}`)} last /> : null}
        {!data?.supportPhone && !data?.supportEmail ? <MenuRow icon="information-circle-outline" title="Support details are not set up yet" subtitle="The operator can add a phone number and email in the admin console." last /> : null}
      </Card>
      <SectionLabel>Emergency</SectionLabel>
      <Card><MenuRow icon="alert-circle-outline" title="Call 112" subtitle="For any emergency, call the national emergency number first." onPress={() => Linking.openURL('tel:112')} danger last /></Card>
    </Screen>
  );
}
