import { decodePolyline, decodeRouteGeometry, toPlaces, addressFromReverse, summariseRoute, haversineKm } from '../lib/places-core';
let pass = 0, fail = 0;
const check = (n: string, c: boolean, x: any = '') => { if (c) { pass++; console.log('  ok  ', n); } else { fail++; console.log('  FAIL', n, JSON.stringify(x)); } };
// a polyline ENCODER, only to build test data
function encode(points: {lat:number;lng:number}[], precision: number) {
  const f = Math.pow(10, precision); let pl = 0, pn = 0, s = '';
  const enc = (v: number) => { v = v < 0 ? ~(v << 1) : v << 1; let o = ''; while (v >= 0x20) { o += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; } return o + String.fromCharCode(v + 63); };
  for (const p of points) { const la = Math.round(p.lat * f), ln = Math.round(p.lng * f); s += enc(la - pl) + enc(ln - pn); pl = la; pn = ln; }
  return s;
}
// Google's published example
const g = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@', 5);
check('decodes the well-known reference polyline', g.length === 3 && Math.abs(g[0].lat - 38.5) < 1e-9 && Math.abs(g[0].lng + 120.2) < 1e-9 && Math.abs(g[2].lng + 126.453) < 1e-9, g);
const town = [{ lat: 17.1225, lng: 81.2945 }, { lat: 17.1262, lng: 81.2998 }, { lat: 17.1291, lng: 81.3031 }];
const o = town[0];
for (const prec of [5, 6]) {
  const pts = decodeRouteGeometry(encode(town, prec), o);
  check(`picks precision ${prec} automatically`, pts.length === 3 && haversineKm(pts[2], town[2]) < 0.01, pts);
}
const geo = decodeRouteGeometry({ type: 'LineString', coordinates: town.map(p => [p.lng, p.lat]) }, o);
check('also accepts a GeoJSON line', geo.length === 3 && geo[1].lat === 17.1262);
check('garbage text gives no line (not a crash)', decodeRouteGeometry('@@@@', o).length === 0);
check('a line that starts far from the origin is rejected', decodeRouteGeometry(encode([{ lat: 28.6, lng: 77.2 }, { lat: 28.7, lng: 77.3 }], 5), o).length === 0);
check('missing geometry gives no line', decodeRouteGeometry(undefined, o).length === 0 && decodeRouteGeometry('', o).length === 0);
const sugg = { suggestedLocations: [
  { mapplsPin: 'AAA111', placeName: 'Bus Stand', placeAddress: 'Jangareddygudem, West Godavari, Andhra Pradesh, 534447', latitude: 17.1262, longitude: 81.2998 },
  { mapplsPin: 'AAA111', placeName: 'Bus Stand', placeAddress: 'duplicate pin', latitude: 17.1262, longitude: 81.2998 },
  { mapplsPin: 'BBB222', placeName: '', placeAddress: 'Market Road, Jangareddygudem', entryLatitude: 17.1291, entryLongitude: 81.2902 },
  { mapplsPin: 'CCC333', placeName: 'No coordinates', placeAddress: 'x' },
], userAddedLocations: [] };
const pl = toPlaces(sugg);
check('search results: keeps good rows, drops duplicates and rows without coordinates', pl.length === 2 && pl[0].lat === 17.1262 && pl[1].lat === 17.1291, pl);
check('search results: label is the name, falling back to the address', pl[0].label === 'Bus Stand' && pl[1].label === 'Market Road, Jangareddygudem', pl);
check('search results: empty or missing answer gives an empty list', toPlaces({}).length === 0 && toPlaces(undefined).length === 0);
check('address: uses the formatted address', addressFromReverse({ results: [{ formatted_address: 'Main Road, Jangareddygudem' }] }, 17.1, 81.2) === 'Main Road, Jangareddygudem');
check('address: builds one from parts when there is no formatted address', addressFromReverse({ results: [{ street: 'Main Road', locality: 'Jangareddygudem' }] }, 17.1, 81.2) === 'Main Road, Jangareddygudem');
check('address: falls back to coordinates', addressFromReverse({}, 17.12346, 81.29876) === '17.1235, 81.2988');
const r = summariseRoute({ routes: [{ distance: 4213.4, duration: 735, geometry: encode(town, 6) }] }, o);
check('route: kilometres, minutes and a line', !!r && Math.abs(r.km - 4.2134) < 1e-6 && Math.abs(r.minutes - 12.25) < 1e-9 && r.points.length === 3, r);
check('route: no routes means null', summariseRoute({ routes: [] }, o) === null && summariseRoute(undefined, o) === null);
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
