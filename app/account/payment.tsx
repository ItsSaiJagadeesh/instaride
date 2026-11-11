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
        <MenuRow icon="cash-outline" title="Cash" subtitle="Pay your driver the fare at the end of the trip." right={<Ionicons name="checkmark-circle" size={22} color={Colors.primaryDark} />} last />
      </Card>
      <SectionLabel>Coming later</SectionLabel>
      <Card>
        <MenuRow icon="phone-portrait-outline" title="UPI and wallet" subtitle="Not available yet. For now please pay in cash." last />
      </Card>
      <SectionLabel>How fares work</SectionLabel>
      <Card>
        <MenuRow icon="calculator-outline" title="Fare shown before you book" subtitle="Base fare plus distance and time, with a minimum fare. You see the total for each vehicle type before you confirm." last />
      </Card>
    </Screen>
  );
}
