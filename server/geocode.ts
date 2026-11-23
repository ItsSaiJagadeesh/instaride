/*
 * InstaRide: a fork of RideFlow (GPL-3.0-or-later).
 * Address search, called from the SERVER so no key ever ships inside the app.
 *   1. Google Places API (New), when GOOGLE_PLACES_API_KEY is set: autocomplete while typing, then a
 *      details call for the one place the rider picks (that is where the coordinates come from).
 *   2. OpenStreetMap's Nominatim as the fallback (no key, or Google fails). It asks for an identifying
 *      User-Agent, at most one request per second and caching, so those rules stay in place.
 * Set GEOCODER_URL to point Nominatim at your own server or another compatible service.
 */
import type { PlatformConfig } from "@shared/schema";

const BASE = (process.env.GEOCODER_URL || "https://nominatim.openstreetmap.org").replace(/\/$/, "");
const MIN_GAP_MS = Number(process.env.GEOCODER_MIN_GAP_MS || 1100);
const MAX_QUEUE = 10;
const TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CACHE = 500;

export interface Place {
  label: string; // short name for lists
  address: string; // longer line
  lat: number;
  lng: number;
}

/** A search suggestion. Google suggestions carry a placeId and no coordinates until resolvePlace() is called. */
export interface Suggestion {
  label: string;
  address: string;
  lat: number | null;
  lng: number | null;
  placeId?: string;
}

export interface SearchOptions {
  lat?: number; // the rider's position, used to rank nearby places first
  lng?: number;
  sessionToken?: string; // groups one search session (typing + the final pick) into one Google billing session
}

const GOOGLE_KEY = () => (process.env.GOOGLE_PLACES_API_KEY || "").trim();
const GOOGLE_BASE = "https://places.googleapis.com/v1";

const cache = new Map<string, { at: number; value: unknown }>();
let queue: Promise<unknown> = Promise.resolve();
let queued = 0;
let lastCall = 0;

function remember(key: string, value: unknown) {
  if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value as string);
  cache.set(key, { at: Date.now(), value });
}

function recall<T>(key: string): T | undefined {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (Date.now() - hit.at > TTL_MS) {
    cache.delete(key);
    return undefined;
  }
  return hit.value as T;
}

/** Runs upstream calls one at a time with a minimum gap between them. */
function schedule<T>(job: () => Promise<T>): Promise<T> {
  if (queued >= MAX_QUEUE) {
    return Promise.reject(Object.assign(new Error("Address search is busy. Please try again in a moment."), { status: 429 }));
  }
  queued++;
  const run = queue.then(async () => {
    const wait = lastCall + MIN_GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();
    try {
      return await job();
    } finally {
      queued--;
    }
  });
  queue = run.catch(() => undefined);
  return run;
}

async function upstream(path: string, params: Record<string, string>): Promise<any> {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 6000);
  try {
    const res = await fetch(url, {
      signal: ctl.signal,
      headers: {
        "User-Agent": `InstaRide/1.0 (${process.env.GEOCODER_CONTACT || "contact not set"})`,
        "Accept-Language": "en",
      },
    });
    if (!res.ok) throw Object.assign(new Error("Address search is unavailable right now."), { status: 502 });
    return await res.json();
  } catch (e: any) {
    if (e?.status) throw e;
    throw Object.assign(new Error("Address search is unavailable right now."), { status: 502 });
  } finally {
    clearTimeout(timer);
  }
}

function shorten(display: string): { label: string; address: string } {
  const parts = display.split(",").map((s) => s.trim()).filter(Boolean);
  return { label: parts.slice(0, 2).join(", ") || display, address: parts.slice(0, 5).join(", ") || display };
}

function distKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const r = Math.PI / 180;
  const x = Math.sin(((bLat - aLat) * r) / 2) ** 2 +
    Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(((bLng - aLng) * r) / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

/** Calls Google Places (New). Logs the status and error body (never the key) so a bad setup is easy to find. */
async function google(path: string, init: { method: "GET" | "POST"; fieldMask: string; body?: unknown }): Promise<any> {
  const key = GOOGLE_KEY();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 6000);
  try {
    const res = await fetch(GOOGLE_BASE + path, {
      method: init.method,
      signal: ctl.signal,
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": init.fieldMask,
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
    if (!res.ok) {
      const text = (await res.text().catch(() => "")).slice(0, 400);
      console.error(`[places] Google Places ${init.method} ${path.split("?")[0]} -> HTTP ${res.status}: ${text}`);
      if (res.status === 403 || res.status === 401) {
        console.error("[places] Check: Places API (New) is enabled for this key's project, billing is on, and the key is not restricted to Android apps/referrers (server keys need an IP restriction or none).");
      }
      throw Object.assign(new Error("Address search is unavailable right now."), { status: res.status === 429 ? 429 : 502 });
    }
    return await res.json();
  } catch (e: any) {
    if (e?.status) throw e;
    console.error(`[places] Google Places request failed: ${e?.name || "error"}`);
    throw Object.assign(new Error("Address search is unavailable right now."), { status: 502 });
  } finally {
    clearTimeout(timer);
  }
}

async function googleSuggest(q: string, area: PlatformConfig["serviceArea"], opts: SearchOptions): Promise<Suggestion[]> {
  const centre = { latitude: opts.lat ?? area.lat, longitude: opts.lng ?? area.lng };
  const data = await google("/places:autocomplete", {
    method: "POST",
    fieldMask: "suggestions.placePrediction.placeId,suggestions.placePrediction.text,suggestions.placePrediction.structuredFormat",
    body: {
      input: q,
      languageCode: "en",
      includedRegionCodes: ["in"],
      locationBias: { circle: { center: centre, radius: 50000 } },
      ...(opts.sessionToken ? { sessionToken: opts.sessionToken } : {}),
    },
  });
  const out: Suggestion[] = [];
  for (const s of Array.isArray(data?.suggestions) ? data.suggestions : []) {
    const p = s?.placePrediction;
    const placeId = String(p?.placeId || "");
    const full = String(p?.text?.text || "").trim();
    const main = String(p?.structuredFormat?.mainText?.text || "").trim();
    if (!placeId || !(main || full)) continue;
    out.push({ label: main || full, address: full || main, lat: null, lng: null, placeId });
    if (out.length >= 6) break;
  }
  return out;
}

async function nominatimSuggest(q: string, area: PlatformConfig["serviceArea"], opts: SearchOptions): Promise<Suggestion[]> {
  const aroundLat = opts.lat ?? area.lat;
  const aroundLng = opts.lng ?? area.lng;
  const key = `s:${area.lat.toFixed(2)},${area.lng.toFixed(2)}:${aroundLat.toFixed(2)},${aroundLng.toFixed(2)}:${q.toLowerCase()}`;
  const hit = recall<Suggestion[]>(key);
  if (hit) return hit;

  // The box is only a preference (bounded=0): places just outside it still come back, ranked lower, so a rider
  // can pick a destination in another town (intercity). We then sort by distance from the rider ourselves.
  const deg = Math.max(area.radiusKm, 5) / 111; // roughly kilometres to degrees
  const viewbox = [area.lng - deg, area.lat + deg, area.lng + deg, area.lat - deg].join(",");
  const data = await schedule(() =>
    upstream("/search", { format: "jsonv2", q, limit: "8", countrycodes: "in", viewbox, bounded: "0" }),
  );
  const places: Suggestion[] = (Array.isArray(data) ? data : [])
    .map((r: any) => ({ ...shorten(String(r.display_name || "")), lat: Number(r.lat), lng: Number(r.lon) }))
    .filter((p) => isFinite(p.lat as number) && isFinite(p.lng as number) && p.label)
    .sort((a, b) => distKm(aroundLat, aroundLng, a.lat as number, a.lng as number) - distKm(aroundLat, aroundLng, b.lat as number, b.lng as number))
    .slice(0, 6);
  remember(key, places);
  return places;
}

/**
 * Suggestions for what the rider has typed. Google Places when a key is set; if Google fails (or there is no
 * key) the Nominatim fallback answers instead. Throws only when no source could answer.
 */
export async function searchPlaces(query: string, area: PlatformConfig["serviceArea"], opts: SearchOptions = {}): Promise<Suggestion[]> {
  const q = query.trim().replace(/\s+/g, " ").slice(0, 120);
  if (q.length < 3) return [];

  if (GOOGLE_KEY()) {
    const gKey = `g:${(opts.lat ?? area.lat).toFixed(2)},${(opts.lng ?? area.lng).toFixed(2)}:${q.toLowerCase()}`;
    const hit = recall<Suggestion[]>(gKey);
    if (hit) return hit;
    try {
      const found = await googleSuggest(q, area, opts);
      remember(gKey, found);
      return found;
    } catch (e) {
      console.error("[places] Google failed, using the Nominatim fallback");
    }
  }
  return nominatimSuggest(q, area, opts);
}

/** The name, address and coordinates of one Google suggestion the rider picked. */
export async function resolvePlace(placeId: string, sessionToken?: string): Promise<Suggestion | null> {
  if (!GOOGLE_KEY()) return null;
  const key = `d:${placeId}`;
  const hit = recall<Suggestion | null>(key);
  if (hit !== undefined) return hit;
  const qs = sessionToken ? `?sessionToken=${encodeURIComponent(sessionToken)}` : "";
  const d = await google(`/places/${encodeURIComponent(placeId)}${qs}`, {
    method: "GET",
    fieldMask: "id,displayName,formattedAddress,location",
  });
  const lat = Number(d?.location?.latitude);
  const lng = Number(d?.location?.longitude);
  if (!isFinite(lat) || !isFinite(lng)) return null;
  const label = String(d?.displayName?.text || "").trim() || String(d?.formattedAddress || "").trim();
  const address = String(d?.formattedAddress || "").trim() || label;
  const out: Suggestion = { label, address, lat, lng, placeId: String(d?.id || placeId) };
  remember(key, out);
  return out;
}

export async function reversePlace(lat: number, lng: number): Promise<{ label: string; address: string } | null> {
  const key = `r:${lat.toFixed(4)},${lng.toFixed(4)}`;
  const hit = recall<{ label: string; address: string } | null>(key);
  if (hit !== undefined) return hit;
  const data = await schedule(() =>
    upstream("/reverse", { format: "jsonv2", lat: String(lat), lon: String(lng), zoom: "18" }),
  );
  const out = data && data.display_name ? shorten(String(data.display_name)) : null;
  remember(key, out);
  return out;
}
