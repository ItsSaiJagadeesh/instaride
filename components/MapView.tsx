/*
 * InstaRide: a fork of RideFlow (GPL-3.0-or-later).
 * The map on Android and iPhone.
 *
 * Android's map needs a Google Maps API key inside the app. Without one the app can crash the moment a map is drawn.
 * So the real map is used ONLY when the build was made with a key (EXPO_PUBLIC_MAPS=native), or in Expo Go, which
 * brings its own. Every other build (the demo, or a live build before you have a key) shows a clearly labelled
 * placeholder, and everything else in the app still works.
 */
import React, { forwardRef, useImperativeHandle } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type RNMapView from 'react-native-maps';

const NATIVE_MAPS = process.env.EXPO_PUBLIC_MAPS === 'native';
// Loaded only when wanted, so builds without a key never even start the Google map code.
const RN: typeof import('react-native-maps') | null = NATIVE_MAPS ? require('react-native-maps') : null;

const PlaceholderMap = forwardRef<any, any>(function PlaceholderMap(props, ref) {
  useImperativeHandle(ref, () => ({
    animateToRegion: () => {},
    animateCamera: () => {},
    fitToCoordinates: () => {},
  }));
  return (
    <View style={[styles.box, props.style]} accessibilityLabel="Map placeholder">
      <View style={styles.grid} pointerEvents="none" />
      <Text style={styles.text}>Map preview is not available in this build.</Text>
      <Text style={styles.sub}>Everything else works. The finished app shows a live map here.</Text>
    </View>
  );
});

type MapView = RNMapView;
const MapView = (NATIVE_MAPS && RN ? RN.default : PlaceholderMap) as unknown as typeof RNMapView;
export default MapView;

export const Marker = (NATIVE_MAPS && RN ? RN.Marker : () => null) as unknown as typeof import('react-native-maps').Marker;
export const PROVIDER_DEFAULT = NATIVE_MAPS && RN ? RN.PROVIDER_DEFAULT : undefined;

const styles = StyleSheet.create({
  box: { backgroundColor: '#1C1C1E', alignItems: 'center', paddingTop: 110, paddingHorizontal: 28 },
  grid: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.08,
    borderColor: '#FFFFFF',
    borderWidth: 0,
    backgroundColor: 'transparent',
  },
  text: { color: 'rgba(255,255,255,0.6)', fontSize: 13, lineHeight: 19, textAlign: 'center' },
  sub: { color: 'rgba(255,255,255,0.4)', fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 4 },
});
