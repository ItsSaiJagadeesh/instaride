/* InstaRide: a fork of RideFlow (GPL-3.0-or-later). Take a photo and upload it as a driver document. */
import { Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { apiRequest } from '@/lib/query-client';
import type { DocumentKind, User } from '@shared/schema';

/** Opens the camera (gallery on the web build) and returns the photo as base64, or null if cancelled. */
export async function pickPhotoBase64(): Promise<string | null> {
  const options: ImagePicker.ImagePickerOptions = {
    mediaTypes: ['images'],
    quality: 0.4,
    base64: true,
    exif: false,
  };
  let result: ImagePicker.ImagePickerResult;
  if (Platform.OS === 'web') {
    result = await ImagePicker.launchImageLibraryAsync(options);
  } else {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) throw new Error('Camera permission is needed to take the photo');
    result = await ImagePicker.launchCameraAsync(options);
  }
  if (result.canceled || !result.assets?.[0]?.base64) return null;
  return result.assets[0].base64;
}

export async function uploadDocument(kind: DocumentKind, base64: string): Promise<User> {
  const res = await apiRequest('PUT', `/api/driver/documents/${kind}`, { data: base64 });
  return res.json();
}

export async function submitVerification(): Promise<User> {
  const res = await apiRequest('POST', '/api/driver/submit', {});
  return res.json();
}
