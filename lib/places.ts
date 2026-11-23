/*
 * InstaRide: a fork of RideFlow (GPL-3.0-or-later).
 * Address search, address lookup and routes for the app.
 *   Mappls build : uses the Mappls SDK's own calls. The SDK is authorised by the licence files built into the
 *                  app, so no client secret is stored in the app.
 *   Other builds : address search and lookup go through our own server (and the demo's sample answers).
 *                  There is no route line.
 */
import { apiRequest } from '@/lib/query-client';
import * as Crypto from 'expo-crypto';
import { addressFromReverse, summariseRoute, toPlaces, type LatLng, type Place, type RouteInfo, type Suggestion } from '@/lib/places-core';

export type { LatLng, Place, RouteInfo, Suggestion };

export const MAPPLS_ON = process.env.EXPO_PUBLIC_MAPS === 'mappls';
// Loaded only for Mappls builds, so other builds never even start the Mappls code.
const mappls: any = MAPPLS_ON ? require('mappls-map-react-native') : null;

/** One id for a whole search session (typing, then picking). The server passes it to Google so it bills one session. */
export function newSearchSession(): string {
  return Crypto.randomUUID();
}

/**
 * Suggestions for a typed address, as the rider types. Pass the rider's position so nearby places rank first.
 * THROWS when search cannot answer (offline, server error), so the screen can show an error and a retry
 * instead of an empty list.
 */
export async function suggestPlaces(query: string, near?: LatLng | null, sessionToken?: string): Promise<Suggestion[]> {
  if (MAPPLS_ON) {
    const answer = await mappls.RestApi.autoSuggest({
      query,
      location: near ? { latitude: near.lat, longitude: near.lng } : undefined,
    });
    return toPlaces(answer);
  }
  const qs = new URLSearchParams({ q: query });
  if (near) { qs.set('lat', String(near.lat)); qs.set('lng', String(near.lng)); }
  if (sessionToken) qs.set('sessionToken', sessionToken);
  const res = await apiRequest('GET', `/api/geocode/search?${qs.toString()}`);
  const places = await res.json();
  return Array.isArray(places) ? places : [];
}

/** Gives a suggestion its coordinates (a Google suggestion needs one extra lookup when it is picked). */
export async function resolveSuggestion(s: Suggestion, sessionToken?: string): Promise<Place> {
  if (s.lat != null && s.lng != null) return { label: s.label, address: s.address, lat: s.lat, lng: s.lng };
  if (!s.placeId) throw new Error('That place has no location. Please pick another.');
  const qs = new URLSearchParams({ placeId: s.placeId });
  if (sessionToken) qs.set('sessionToken', sessionToken);
  const res = await apiRequest('GET', `/api/geocode/details?${qs.toString()}`);
  const d = await res.json();
  const lat = Number(d?.lat), lng = Number(d?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error('Could not get that place\'s location. Please pick another.');
  return { label: String(d.label || s.label), address: String(d.address || s.address), lat, lng };
}

/** Older callers: suggestions that already have coordinates. Never throws; returns [] on any problem. */
export async function searchPlaces(query: string, near?: LatLng | null): Promise<Place[]> {
  try {
    const list = await suggestPlaces(query, near);
    return list.filter((x) => x.lat != null && x.lng != null) as Place[];
  } catch {
    return [];
  }
}

/** A readable address for a spot on the map. Never throws: falls back to the coordinates. */
export async function reversePlace(lat: number, lng: number): Promise<string> {
  const coords = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  try {
    if (MAPPLS_ON) {
      const answer = await mappls.RestApi.reverseGeocode({ latitude: lat, longitude: lng });
      return addressFromReverse(answer, lat, lng);
    }
    const res = await apiRequest('GET', `/api/geocode/reverse?lat=${lat}&lng=${lng}`);
    const data = await res.json();
    return data?.label || coords;
  } catch {
    return coords;
  }
}

/** The road route between two points, or null when there is none (or this build has no route service). */
export async function getRoute(from: LatLng, to: LatLng): Promise<RouteInfo | null> {
  if (!MAPPLS_ON) return null;
  try {
    const answer = await mappls.RestApi.direction({
      origin: `${from.lng},${from.lat}`,
      destination: `${to.lng},${to.lat}`,
      overview: 'full',
      steps: false,
      alternatives: false,
    });
    return summariseRoute(answer, from);
  } catch {
    return null;
  }
}
