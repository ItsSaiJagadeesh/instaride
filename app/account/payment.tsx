/* InstaRide: a fork of RideFlow (GPL-3.0-or-later). Payment information (cash only for now). */
import React from 'react';
import { Screen, Card, MenuRow, SectionLabel } from '@/components/ui';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/colors';

export default function PaymentScreen() {
  return (
    <Screen title="Payment">
      <SectionLabel>How you pay</SectionLabel>
      <Card>
        <MenuRow icon="qr-code-outline" title="UPI" subtitle="After your trip, scan the QR code on your driver's phone with any UPI app. The amount is already filled in. You can also open your UPI app from the trip screen." />
        <MenuRow icon="cash-outline" title="Cash" subtitle="Or hand your driver the fare. Your driver confirms the payment, and then you can review the trip." last />
      </Card>
      <SectionLabel>Good to know</SectionLabel>
      <Card>
        <MenuRow icon="shield-checkmark-outline" title="InstaRide never holds your money" subtitle="You pay your driver directly. We only record that the trip was paid." last />
      </Card>
      <SectionLabel>How fares work</SectionLabel>
      <Card>
        <MenuRow icon="calculator-outline" title="Fare shown before you book" subtitle="Base fare plus distance and time, with a minimum fare. You see the total for each vehicle type before you confirm." last />
      </Card>
    </Screen>
  );
}
