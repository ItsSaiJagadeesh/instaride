/*
 * InstaRide: a fork of RideFlow (GPL-3.0-or-later).
 * DEMO MODE. When the app is built with EXPO_PUBLIC_DEMO=1 it never talks to a server: this file answers
 * the app's requests with sample data, so the app can be shown on any phone without a backend.
 *   - Only the number 9182631581 with the code 123456 can sign in, as a rider or as a driver.
 *   - Everything can be browsed. Booking, accepting rides and deleting the account are switched off.
 */
import type { Ride, RideEvent, User, VehicleType } from '@shared/schema';

export const DEMO_MODE = process.env.EXPO_PUBLIC_DEMO === '1';
export const DEMO_PHONE = '9182631581';
export const DEMO_CODE = '123456';

const CENTRE = { lat: 17.1225, lng: 81.2945 };
const BLOCKED_BOOKING = 'Booking is switched off in this demo, so no driver will be sent. Every other screen works.';
const BLOCKED_ACCEPT = 'Accepting rides is switched off in this demo.';

function respond(body: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response;
}

const day = 86_400_000;
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();
const dateOnly = (offsetMs: number) => iso(offsetMs).slice(0, 10);

// ---- state that lives only while the app is open
const state = {
  rider: { fullName: 'Demo Rider', favourites: [] as NonNullable<User['favourites']>, emergencyContact: undefined as User['emergencyContact'] },
  driver: { fullName: 'Demo Driver', isOnline: false, emergencyContact: undefined as User['emergencyContact'] },
};

function userFor(role: 'rider' | 'driver'): User {
  if (role === 'rider') {
    return {
      id: 'demo-rider', phone: DEMO_PHONE, role: 'rider', fullName: state.rider.fullName, createdAt: iso(-30 * day),
      totalRides: 3, favourites: state.rider.favourites, emergencyContact: state.rider.emergencyContact, feesDue: 0,
    };
  }
  return {
    id: 'demo-driver', phone: DEMO_PHONE, role: 'driver', fullName: state.driver.fullName, createdAt: iso(-60 * day),
    isOnline: state.driver.isOnline, currentLocation: CENTRE,
    vehicle: { type: 'bike', number: 'AP37DM0001', make: 'Demo', model: 'Bike' },
    verification: {
      status: 'approved', uploaded: [], vahanChecked: true,
      insuranceExpiry: dateOnly(200 * day), fitnessExpiry: dateOnly(300 * day), reviewedAt: iso(-50 * day),
    },
    rating: 4.8, totalRides: 24, totalEarnings: 3120, feesDue: 15, emergencyContact: state.driver.emergencyContact,
  };
}

const roleOf = (token: string | null): 'rider' | 'driver' => (token === 'demo.driver' ? 'driver' : 'rider');

// ---- sample places and rides
const PLACES = [
  { label: 'Bus Stand, Jangareddygudem', address: 'Bus Stand, Jangareddygudem, West Godavari, Andhra Pradesh', lat: 17.1262, lng: 81.2998 },
  { label: 'Market Road, Jangareddygudem', address: 'Market Road, Jangareddygudem, West Godavari, Andhra Pradesh', lat: 17.1291, lng: 81.2902 },
  { label: 'Government Hospital, Jangareddygudem', address: 'Government Hospital, Jangareddygudem, West Godavari, Andhra Pradesh', lat: 17.1176, lng: 81.2993 },
  { label: 'Main Road, Jangareddygudem', address: 'Main Road, Jangareddygudem, West Godavari, Andhra Pradesh', lat: 17.1198, lng: 81.2889 },
];

function sampleRide(i: number, role: 'rider' | 'driver'): Ride {
  const specs = [
    { type: 'bike' as VehicleType, status: 'completed' as const, total: 37, km: 2.4, ago: 1, from: PLACES[3], to: PLACES[0] },
    { type: 'auto' as VehicleType, status: 'completed' as const, total: 62, km: 3.9, ago: 4, from: PLACES[1], to: PLACES[2] },
    { type: 'bike' as VehicleType, status: 'cancelled' as const, total: 0, km: 1.8, ago: 9, from: PLACES[0], to: PLACES[1] },
  ];
  const s = specs[i];
  const base = s.type === 'bike' ? 15 : 25;
  const fare = s.total
    ? { baseFare: base, distanceFare: s.total - base - 3, timeFare: 3, totalFare: s.total, platformFee: 5, driverEarnings: s.total - 5 }
    : undefined;
  return {
    id: `demo-ride-${i + 1}`, riderId: 'demo-rider', driverId: 'demo-driver', vehicleType: s.type, status: s.status,
    pickup: { lat: s.from.lat, lng: s.from.lng, address: s.from.label }, dropoff: { lat: s.to.lat, lng: s.to.lng, address: s.to.label },
    fare, distance: s.km, duration: Math.round(s.km * 3), createdAt: iso(-s.ago * day), completedAt: iso(-s.ago * day + 15 * 60_000),
    startedAt: s.status === 'completed' ? iso(-s.ago * day + 4 * 60_000) : undefined,
    riderName: 'Demo Rider', driverName: 'Demo Driver', driverRating: 4.8,
    driverVehicle: { type: s.type, number: s.type === 'bike' ? 'AP37DM0001' : 'AP37DM0002' },
    review: s.status === 'completed' && role === 'rider' ? { rating: 5, createdAt: iso(-s.ago * day + 20 * 60_000) } : undefined,
    cancelledBy: s.status === 'cancelled' ? 'rider' : undefined,
  } as Ride;
}

const sampleEvents = (role: 'rider' | 'driver'): RideEvent[] => [
  { id: 'e1', type: 'ride_completed', rideId: 'demo-ride-1', userId: `demo-${role}`, data: { fare: { totalFare: 37 } }, createdAt: iso(-1 * day), read: true },
  { id: 'e2', type: 'ride_started', rideId: 'demo-ride-1', userId: `demo-${role}`, data: {}, createdAt: iso(-1 * day - 600_000), read: true },
  role === 'driver'
    ? { id: 'e3', type: 'verification_update', rideId: '', userId: 'demo-driver', data: { status: 'approved' }, createdAt: iso(-50 * day), read: true }
    : { id: 'e3', type: 'ride_accepted', rideId: 'demo-ride-1', userId: 'demo-rider', data: { driverName: 'Demo Driver' }, createdAt: iso(-1 * day - 900_000), read: true },
];

// ---- fares: the same simple formula the server uses, with the default rates
const RATES: Record<string, { base: number; perKm: number; perMin: number; min: number }> = {
  bike: { base: 15, perKm: 6, perMin: 0.5, min: 25 },
  auto: { base: 25, perKm: 11, perMin: 1, min: 35 },
};
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371, d2r = Math.PI / 180;
  const dLat = (lat2 - lat1) * d2r, dLon = (lon2 - lon1) * d2r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * d2r) * Math.cos(lat2 * d2r) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function quote(type: string, km: number) {
  const r = RATES[type];
  const distance = km * 1.3, duration = distance * 3;
  const total = Math.round(Math.max(r.base + distance * r.perKm + duration * r.perMin, r.min));
  return {
    baseFare: r.base, distanceFare: Math.round(distance * r.perKm), timeFare: Math.round(duration * r.perMin), totalFare: total,
    platformFee: 5, driverEarnings: total - 5, distance: Math.round(distance * 10) / 10, duration: Math.round(duration),
  };
}

/** Answers one app request. Throws Error(message) the way a failed server call would. */
export async function demoRequest(method: string, route: string, body: any, token: string | null): Promise<Response> {
  const url = new URL(route, 'https://demo.invalid');
  const path = url.pathname;
  const q = url.searchParams;
  const role = roleOf(token);
  const is = (m: string, re: RegExp) => method === m && re.test(path);
  await new Promise((r) => setTimeout(r, 120)); // a touch of delay so it feels like a network

  // ---- sign in: only the demo number and code
  if (is('POST', /^\/api\/auth\/otp\/request$/)) {
    const phone = String(body?.phone ?? '').replace(/[\s-]/g, '').replace(/^(\+91|91)(?=\d{10}$)/, '');
    if (phone !== DEMO_PHONE) throw new Error(`This demo only works with the number ${DEMO_PHONE}.`);
    return respond({ sent: true, resendAfterSeconds: 5 });
  }
  if (is('POST', /^\/api\/auth\/otp\/verify$/)) {
    if (String(body?.otp) !== DEMO_CODE) throw new Error(`Wrong code. In this demo the code is ${DEMO_CODE}.`);
    const r: 'rider' | 'driver' = body?.role === 'driver' ? 'driver' : 'rider';
    return respond({ token: `demo.${r}`, user: userFor(r) });
  }
  if (is('POST', /^\/api\/auth\/signup$/)) throw new Error(`Sign-up is switched off in this demo. Sign in with ${DEMO_PHONE} instead.`);
  if (is('GET', /^\/api\/config\/public$/)) {
    return respond({ enabledVehicleTypes: ['bike', 'auto'], platformFeePerRide: 5, maxFeesDue: 100, serviceAreaName: 'Jangareddygudem', supportPhone: '', supportEmail: '', sourceCodeUrl: '' });
  }

  // ---- account
  if (is('GET', /^\/api\/me$/)) return respond(userFor(role));
  if (is('PUT', /^\/api\/me$/)) {
    const name = String(body?.fullName ?? '').trim();
    if (name.length < 2) throw new Error('Please enter your name');
    if (role === 'rider') state.rider.fullName = name; else state.driver.fullName = name;
    return respond(userFor(role));
  }
  if (is('PUT', /^\/api\/me\/emergency-contact$/)) {
    const ec = { name: String(body?.name ?? '').trim(), phone: String(body?.phone ?? '').replace(/\D/g, '').slice(-10) };
    if (ec.name.length < 2 || ec.phone.length !== 10) throw new Error('Enter a name and a 10-digit mobile number');
    if (role === 'rider') state.rider.emergencyContact = ec; else state.driver.emergencyContact = ec;
    return respond(userFor(role));
  }
  if (is('DELETE', /^\/api\/me\/emergency-contact$/)) {
    if (role === 'rider') state.rider.emergencyContact = undefined; else state.driver.emergencyContact = undefined;
    return respond(userFor(role));
  }
  if (is('POST', /^\/api\/me\/favourites$/)) {
    if (state.rider.favourites.length >= 10) throw new Error('You can save up to 10 places');
    state.rider.favourites = [...state.rider.favourites, { id: `fav-${Date.now()}`, label: String(body?.label), address: String(body?.address), lat: Number(body?.lat), lng: Number(body?.lng) }];
    return respond(userFor('rider'));
  }
  const favDel = /^\/api\/me\/favourites\/(.+)$/.exec(path);
  if (method === 'DELETE' && favDel) {
    state.rider.favourites = state.rider.favourites.filter((f) => f.id !== favDel[1]);
    return respond(userFor('rider'));
  }
  if (is('POST', /^\/api\/me\/otp$/) || is('DELETE', /^\/api\/me$/)) throw new Error('Deleting the account is switched off in this demo.');

  // ---- rider
  if (is('GET', /^\/api\/drivers\/nearby$/)) {
    const lat = Number(q.get('lat')) || CENTRE.lat, lng = Number(q.get('lng')) || CENTRE.lng;
    const spots: [number, number, VehicleType][] = [[0.0016, 0.0012, 'bike'], [-0.0021, 0.0019, 'auto'], [0.0009, -0.0027, 'bike']];
    return respond(spots.map(([dy, dx, t], i) => ({
      id: `demo-d${i}`, vehicleType: t, rating: 4.6 + i * 0.1, currentLocation: { lat: lat + dy, lng: lng + dx },
      distance: Math.round(haversineKm(lat, lng, lat + dy, lng + dx) * 10) / 10,
    })));
  }
  if (is('GET', /^\/api\/fare\/estimate$/)) {
    const km = haversineKm(Number(q.get('pLat')), Number(q.get('pLng')), Number(q.get('dLat')), Number(q.get('dLng')));
    if (!isFinite(km)) throw new Error('Coordinates required');
    if (km < 0.1) throw new Error('Pickup and drop are too close');
    return respond({ quotes: { bike: quote('bike', km), auto: quote('auto', km) } });
  }
  if (is('GET', /^\/api\/geocode\/search$/)) {
    const text = String(q.get('q') ?? '').toLowerCase();
    const hits = PLACES.filter((p) => p.label.toLowerCase().includes(text) || text.length < 3);
    return respond(hits.length ? hits : PLACES.slice(0, 2));
  }
  if (is('GET', /^\/api\/geocode\/reverse$/)) return respond({ label: 'Jangareddygudem', address: 'Jangareddygudem, West Godavari, Andhra Pradesh' });
  if (is('POST', /^\/api\/rides$/)) throw new Error(BLOCKED_BOOKING);
  if (is('GET', /^\/api\/rides\/rider\/[^/]+\/active$/) || is('GET', /^\/api\/rides\/driver\/[^/]+\/active$/)) return respond(null);
  if (is('GET', /^\/api\/rides\/rider\/[^/]+$/)) return respond([0, 1, 2].map((i) => sampleRide(i, 'rider')));
  if (is('GET', /^\/api\/rides\/driver\/[^/]+$/)) return respond([0, 1, 2].map((i) => sampleRide(i, 'driver')));
  const one = /^\/api\/rides\/demo-ride-(\d)$/.exec(path);
  if (method === 'GET' && one) return respond(sampleRide(Number(one[1]) - 1, role));
  if (/^\/api\/rides\/[^/]+\/(share|sos|status|review)$/.test(path)) throw new Error(BLOCKED_BOOKING);

  // ---- driver
  if (is('PUT', /^\/api\/user\/[^/]+\/online$/)) {
    state.driver.isOnline = body?.isOnline === true;
    return respond(userFor('driver'));
  }
  if (is('PUT', /^\/api\/user\/[^/]+\/location$/)) return respond({ success: true });
  if (is('GET', /^\/api\/rides\/available$/)) {
    if (!state.driver.isOnline) return respond([]);
    return respond([{
      id: 'demo-request-1', riderId: 'demo-rider', vehicleType: 'bike', status: 'requested', riderName: 'Sample Rider',
      pickup: { lat: CENTRE.lat + 0.003, lng: CENTRE.lng + 0.002, address: 'Main Road, Jangareddygudem' },
      dropoff: { lat: 17.1262, lng: 81.2998, address: 'Bus Stand, Jangareddygudem' },
      fare: { baseFare: 15, distanceFare: 14, timeFare: 3, totalFare: 32, platformFee: 5, driverEarnings: 27 }, distance: 2.1, duration: 6, createdAt: iso(-30_000),
    }]);
  }
  if (is('PUT', /^\/api\/rides\/[^/]+\/accept$/)) throw new Error(BLOCKED_ACCEPT);
  if (is('PUT', /^\/api\/driver\/documents\/.+$/) || is('POST', /^\/api\/driver\/submit$/)) throw new Error('Your vehicle is already approved in this demo.');

  // ---- notifications
  if (is('GET', /^\/api\/events\/[^/]+$/)) return respond(sampleEvents(role));
  if (is('PUT', /^\/api\/events\/[^/]+\/read$/)) return respond({ success: true });

  throw new Error('This part is switched off in the demo.');
}
