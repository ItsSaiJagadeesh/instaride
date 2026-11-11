/*
 * InstaRide: a fork of RideFlow (GPL-3.0-or-later).
 * Address search through OpenStreetMap's Nominatim, called from the SERVER so that we can follow its
 * usage policy: an identifying User-Agent, at most one request per second, caching, and no
 * search-as-you-type. Fine for a small pilot. For real volume run your own Nominatim or use a paid
 * places service (set GEOCODER_URL to point at it).
 */
import type { PlatformConfig } from "@shared/schema";

const BASE = (process.env.GEOCODER_URL || "https://nominatim.openstreetmap.org").replace(/\/$/, "");
const MIN_GAP_MS = Number(process.env.GEOCODER_MIN_GAP_MS || 1100);
const MAX_QUEUE = 6;
const TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CACHE = 500;

export interface Place {
  label: string; // short name for lists
  address: string; // longer line
  lat: number;
  lng: number;
}

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

/** Search for a place near the service area. Results are limited to a box around the service area. */
export async function searchPlaces(query: string, area: PlatformConfig["serviceArea"]): Promise<Place[]> {
  const q = query.trim().replace(/\s+/g, " ").slice(0, 120);
  if (q.length < 3) return [];
  const key = `s:${area.lat.toFixed(2)},${area.lng.toFixed(2)}:${q.toLowerCase()}`;
  const hit = recall<Place[]>(key);
  if (hit) return hit;

  const deg = Math.max(area.radiusKm, 5) / 111; // roughly kilometres to degrees
  const viewbox = [area.lng - deg, area.lat + deg, area.lng + deg, area.lat - deg].join(",");
  const data = await schedule(() =>
    upstream("/search", { format: "jsonv2", q, limit: "5", countrycodes: "in", viewbox, bounded: "1" }),
  );
  const places: Place[] = (Array.isArray(data) ? data : [])
    .map((r: any) => ({ ...shorten(String(r.display_name || "")), lat: Number(r.lat), lng: Number(r.lon) }))
    .filter((p: Place) => isFinite(p.lat) && isFinite(p.lng) && p.label);
  remember(key, places);
  return places;
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
