/*
 * InstaRide: a fork of RideFlow (GPL-3.0-or-later).
 * Keeps the login token in the phone's secure keystore (Keychain / Android Keystore).
 * On the web build it falls back to AsyncStorage (browser local storage).
 */
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'instaride_token';

export async function loadToken(): Promise<string | null> {
  try {
    if (Platform.OS === 'web') return await AsyncStorage.getItem(KEY);
    return await SecureStore.getItemAsync(KEY);
  } catch {
    return null;
  }
}

export async function saveToken(token: string): Promise<void> {
  if (Platform.OS === 'web') await AsyncStorage.setItem(KEY, token);
  else await SecureStore.setItemAsync(KEY, token);
}

export async function clearToken(): Promise<void> {
  try {
    if (Platform.OS === 'web') await AsyncStorage.removeItem(KEY);
    else await SecureStore.deleteItemAsync(KEY);
  } catch {}
}
