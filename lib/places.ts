/*
 * InstaRide: a fork of RideFlow (GPL-3.0-or-later).
 * Address search, address lookup and routes for the app.
 *   Mappls build : uses the Mappls SDK's own calls. The SDK is authorised by the licence files built into the
 *                  app, so no client secret is stored in the app.
 *   Other builds : address search and lookup go through our own server (and the demo's sample answers).
 *                  There is no route line.
 */
import { apiRequest } from '@/lib/query-client';
import { addressFromReverse, summariseRoute, toPlaces, type LatLng, type Place, type RouteInfo } from '@/lib/places-core';

export type { LatLng, Place, RouteInfo };

export const MAPPLS_ON = process.env.EXPO_PUBLIC_MAPS === 'mappls';
// Loaded only for Mappls builds, so other builds never even start the Mappls code.
const mappls: any = MAPPLS_ON ? require('mappls-map-react-native') : null;

/** Place suggestions for a typed address. Pass the rider's position so nearby places rank first. */
export async function searchPlaces(query: string, near?: LatLng | null): Promise<Place[]> {
  if (MAPPLS_ON) {
    const answer = await mappls.RestApi.autoSuggest({
      query,
      location: near ? { latitude: near.lat, longitude: near.lng } : undefined,
    });
    return toPlaces(answer);
  }
  const res = await apiRequest('GET', `/api/geocode/search?q=${encodeURIComponent(query)}`);
  const places = await res.json();
  return Array.isArray(places) ? places : [];
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
