/* InstaRide: a fork of RideFlow (GPL-3.0-or-later). InstaRider bottom tabs: Home, My rides, Profile. */
import React from 'react';
import { Platform } from 'react-native';
import { Tabs, Redirect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/colors';
import { roleAllowed } from '@/lib/variant';
import { useAuth } from '@/lib/auth-context';

export default function RiderTabs() {
  const { user, isLoading } = useAuth();
  if (!roleAllowed('rider') || (!isLoading && !user)) return <Redirect href="/" />;
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: Colors.primaryDark,
        tabBarInactiveTintColor: Colors.textLight,
        // The web tab bar is 48px tall, too short for an icon plus a label.
        ...(Platform.OS === 'web' ? { tabBarStyle: { height: 78, paddingTop: 8, paddingBottom: 14 } } : {}),
        tabBarLabelStyle: { fontFamily: 'Inter_500Medium', fontSize: 11, lineHeight: 14, marginBottom: 2 },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: ({ color }) => <Ionicons name="home" size={22} color={color} /> }} />
      <Tabs.Screen name="rides" options={{ title: 'My rides', tabBarIcon: ({ color }) => <Ionicons name="time" size={22} color={color} /> }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: ({ color }) => <Ionicons name="person" size={22} color={color} /> }} />
    </Tabs>
  );
}
