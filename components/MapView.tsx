/*
 * InstaRide: a fork of RideFlow (GPL-3.0-or-later).
 * The map on Android and iPhone. Which one is used is decided when the app is built (EXPO_PUBLIC_MAPS):
 *   mappls : the Mappls map. Needs the Mappls licence files inside the build and the app signed with the
 *            registered key (the build workflow only turns this on when both are in place).
 *   native : the old Google map. Needs a Google Maps key and is being retired.
 *   (else) : a clearly labelled placeholder, so a build without a map can never crash the app.
 * The screens use the same props in every mode. The Mappls logo and copyright are left visible, as its terms require.
 */
import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type RNMapView from 'react-native-maps';

const MODE = process.env.EXPO_PUBLIC_MAPS;
const MAPPLS = MODE === 'mappls';
const GOOGLE = MODE === 'native';

// Each map library is loaded only in the mode that uses it.
const RN: typeof import('react-native-maps') | null = GOOGLE ? require('react-native-maps') : null;
const M: any = MAPPLS ? require('mappls-map-react-native') : null;

const zoomFromDelta = (delta: number) => Math.max(3, Math.min(20, Math.log2(360 / Math.max(delta, 0.0005))));

/* ------------------------------------------------------------------ placeholder (no map in this build) */
const PlaceholderMap = forwardRef<any, any>(function PlaceholderMap(props, ref) {
  useImperativeHandle(ref, () => ({ animateToRegion: () => {}, animateCamera: () => {}, fitToCoordinates: () => {} }));
  return (
    <View style={[styles.box, props.style]} accessibilityLabel="Map placeholder">
      <Text style={styles.text}>Map preview is not available in this build.</Text>
      <Text style={styles.sub}>Everything else works. The finished app shows a live map here.</Text>
    </View>
  );
});

/* ------------------------------------------------------------------------------------------ Mappls map */
const MapplsMap = forwardRef<any, any>(function MapplsMap(props, ref) {
  const { style, initialRegion, showsUserLocation, onPress, children } = props;
  const camera = useRef<any>(null);

  useImperativeHandle(ref, () => ({
    animateToRegion: (region: any, duration = 500) =>
      camera.current?.setCamera?.({
        centerCoordinate: [region.longitude, region.latitude],
        zoomLevel: zoomFromDelta(region.latitudeDelta ?? 0.015),
        animationDuration: duration,
      }),
    animateCamera: () => {},
    // Fits the whole route on screen. Takes [{ latitude, longitude }, ...].
    fitToCoordinates: (coords: { latitude: number; longitude: number }[], options?: any) => {
      if (!coords?.length) return;
      const lats = coords.map((c) => c.latitude), lngs = coords.map((c) => c.longitude);
      const pad = options?.edgePadding;
      camera.current?.fitBounds?.(
        [Math.max(...lngs), Math.max(...lats)],
        [Math.min(...lngs), Math.min(...lats)],
        pad ? [pad.top ?? 80, pad.right ?? 60, pad.bottom ?? 300, pad.left ?? 60] : [100, 60, 320, 60],
        700,
      );
    },
  }));

  const start = initialRegion
    ? { centerCoordinate: [initialRegion.longitude, initialRegion.latitude], zoomLevel: zoomFromDelta(initialRegion.latitudeDelta ?? 0.015) }
    : undefined;

  return (
    <M.MapView
      style={style}
      onPress={(feature: any) => {
        const c = feature?.geometry?.coordinates;
        if (onPress && Array.isArray(c)) onPress({ nativeEvent: { coordinate: { latitude: c[1], longitude: c[0] } } });
      }}
    >
      <M.Camera ref={camera} defaultSettings={start} />
      {showsUserLocation ? <M.UserLocation /> : null}
      {children}
    </M.MapView>
  );
});

function MapplsMarker({ coordinate, children }: any) {
  return (
    <M.MarkerView coordinate={[coordinate.longitude, coordinate.latitude]}>
      {children ?? <View style={styles.pin} />}
    </M.MarkerView>
  );
}

function MapplsRouteLine({ id = 'route', coordinates, color = '#00B386', width = 5 }: RouteLineProps) {
  if (!coordinates || coordinates.length < 2) return null;
  const shape = {
    type: 'Feature',
    properties: {},
    geometry: { type: 'LineString', coordinates: coordinates.map((c) => [c.lng, c.lat]) },
  };
  return (
    <M.ShapeSource id={`${id}-source`} shape={shape}>
      <M.LineLayer id={`${id}-line`} style={{ lineColor: color, lineWidth: width, lineCap: 'round', lineJoin: 'round' }} />
    </M.ShapeSource>
  );
}

/* --------------------------------------------------------------------------------------------- exports */
type MapView = RNMapView;
const MapView = (MAPPLS ? MapplsMap : GOOGLE && RN ? RN.default : PlaceholderMap) as unknown as typeof RNMapView;
export default MapView;

export const Marker = (MAPPLS ? MapplsMarker : GOOGLE && RN ? RN.Marker : () => null) as unknown as typeof import('react-native-maps').Marker;
export const PROVIDER_DEFAULT = GOOGLE && RN ? RN.PROVIDER_DEFAULT : undefined;

export interface RouteLineProps {
  id?: string;
  coordinates: { lat: number; lng: number }[];
  color?: string;
  width?: number;
}
/** A line on the map, for a route. Only the Mappls map draws it. */
export const RouteLine: (props: RouteLineProps) => React.ReactElement | null = MAPPLS ? MapplsRouteLine : () => null;

const styles = StyleSheet.create({
  box: { backgroundColor: '#1C1C1E', alignItems: 'center', paddingTop: 110, paddingHorizontal: 28 },
  text: { color: 'rgba(255,255,255,0.6)', fontSize: 13, lineHeight: 19, textAlign: 'center' },
  sub: { color: 'rgba(255,255,255,0.4)', fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 4 },
  pin: { width: 14, height: 14, borderRadius: 7, backgroundColor: '#00B386', borderWidth: 2, borderColor: '#FFFFFF' },
});
