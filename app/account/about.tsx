/* InstaRide: a fork of RideFlow (GPL-3.0-or-later). About, legal pages and licence. */
import React from 'react';
import { Linking, Alert } from 'react-native';
import { DEMO_MODE } from '@/lib/demo';
import Constants from 'expo-constants';
import { Screen, Card, MenuRow, SectionLabel } from '@/components/ui';
import { getApiUrl } from '@/lib/query-client';
import { useApiGet } from '@/lib/use-api';
import { APP_TITLE } from '@/lib/variant';

export default function AboutScreen() {
  const { data } = useApiGet<{ sourceCodeUrl: string }>('/api/config/public');
  const open = (path: string) => {
    if (DEMO_MODE) return Alert.alert('Not in the demo', 'The privacy policy and terms pages live on the real server, which this demo does not use.');
    return Linking.openURL(new URL(path, getApiUrl()).href);
  };
  return (
    <Screen title="About">
      <Card>
        <MenuRow icon="apps-outline" title={APP_TITLE} subtitle={`Version ${Constants.expoConfig?.version ?? '1.0.0'}`} last />
      </Card>
      <SectionLabel>Legal</SectionLabel>
      <Card>
        <MenuRow icon="document-text-outline" title="Privacy policy" onPress={() => open('/legal/privacy')} />
        <MenuRow icon="reader-outline" title="Terms and conditions" onPress={() => open('/legal/terms')} last />
      </Card>
      <SectionLabel>Open source</SectionLabel>
      <Card>
        <MenuRow
          icon="code-slash-outline"
          title="Source code and licence"
          subtitle={data?.sourceCodeUrl ? 'Free software under the GNU GPL v3 or later. Tap for the source code.' : 'Free software under the GNU GPL v3 or later, based on RideFlow.'}
          onPress={data?.sourceCodeUrl ? () => Linking.openURL(data.sourceCodeUrl) : undefined}
          last
        />
      </Card>
    </Screen>
  );
}
