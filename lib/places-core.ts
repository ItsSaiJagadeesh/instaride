/*
 * InstaRide: a fork of RideFlow (GPL-3.0-or-later).
 * Plain helpers for places and routes. No React Native in here, so they can be tested on their own.
 * The shapes below follow the Mappls SDK's own type definitions (mappls-map-react-native 2.0.3).
 */
export interface LatLng { lat: number; lng: number }
export interface Place { label: string; address: string; lat: number; lng: number }
export interface RouteInfo { points: LatLng[]; km: number; minutes: number }

export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371, d2r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * d2r, dLng = (b.lng - a.lng) * d2r;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * d2r) * Math.cos(b.lat * d2r) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

/** The standard "encoded polyline" format. precision 5 and 6 are both in use. */
export function decodePolyline(encoded: string, precision: number): LatLng[] {
  const factor = Math.pow(10, precision);
  const out: LatLng[] = [];
  let index = 0, lat = 0, lng = 0;
  while (index < encoded.length) {
    for (const axis of ['lat', 'lng'] as const) {
      let result = 0, shift = 0, byte: number;
      do {
        if (index >= encoded.length) return out;
        byte = encoded.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (axis === 'lat') lat += delta; else lng += delta;
    }
    out.push({ lat: lat / factor, lng: lng / factor });
  }
  return out;
}

const valid = (p: LatLng) => Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;

/**
 * Turns the route line Mappls returns into points. It may be a GeoJSON object or an encoded string whose
 * precision (5 or 6 decimals) is not stated, so both are tried and the one that starts next to the origin wins.
 */
export function decodeRouteGeometry(geometry: unknown, origin: LatLng): LatLng[] {
  if (geometry && typeof geometry === 'object' && Array.isArray((geometry as any).coordinates)) {
    return (geometry as any).coordinates
      .map((c: number[]) => ({ lat: Number(c[1]), lng: Number(c[0]) }))
      .filter(valid);
  }
  if (typeof geometry !== 'string' || !geometry) return [];
  let best: LatLng[] = [];
  let bestDistance = Infinity;
  for (const precision of [5, 6]) {
    const pts = decodePolyline(geometry, precision);
    if (pts.length < 2 || !pts.every(valid)) continue;
    const d = haversineKm(pts[0], origin);
    if (d < bestDistance) { bestDistance = d; best = pts; }
  }
  return bestDistance <= 5 ? best : [];
}

/** Search suggestions from the Mappls autosuggest answer, in the shape the screens already use. */
export function toPlaces(resp: any, max = 8): Place[] {
  const rows: any[] = [...(resp?.suggestedLocations ?? []), ...(resp?.userAddedLocations ?? [])];
  const seen = new Set<string>();
  const out: Place[] = [];
  for (const r of rows) {
    const lat = Number(r?.latitude ?? r?.entryLatitude);
    const lng = Number(r?.longitude ?? r?.entryLongitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const name = String(r?.placeName ?? '').trim();
    const addr = String(r?.placeAddress ?? '').trim();
    const label = name || addr;
    if (!label) continue;
    const key = String(r?.mapplsPin ?? `${lat.toFixed(5)},${lng.toFixed(5)}`);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ label, address: addr && addr !== label ? `${label}, ${addr}` : label, lat, lng });
    if (out.length >= max) break;
  }
  return out;
}

/** A readable address from the Mappls reverse-geocoding answer, or the coordinates if there is nothing better. */
export function addressFromReverse(resp: any, lat: number, lng: number): string {
  const p = resp?.results?.[0];
  const formatted = String(p?.formatted_address ?? '').trim();
  if (formatted) return formatted;
  const parts = [p?.poi, p?.street, p?.subLocality, p?.locality, p?.city].map((x: any) => String(x ?? '').trim()).filter(Boolean);
  return parts.length ? parts.join(', ') : `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
}

/** Distance (km), time (minutes) and the line to draw, from the Mappls directions answer. */
export function summariseRoute(resp: any, origin: LatLng): RouteInfo | null {
  const r = resp?.routes?.[0];
  if (!r || !Number.isFinite(Number(r.distance))) return null;
  return {
    points: decodeRouteGeometry(r.geometry, origin),
    km: Number(r.distance) / 1000,
    minutes: Number(r.duration) / 60,
  };
}
