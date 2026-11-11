/* InstaRide: a fork of RideFlow (GPL-3.0-or-later). Indian formats: rupees and DD/MM/YYYY. */

export function formatINR(amount: number | undefined | null): string {
  const n = Math.round(amount || 0);
  return '₹' + n.toLocaleString('en-IN');
}

/** Accepts an ISO date or datetime and returns DD/MM/YYYY in Indian time. */
export function formatDate(iso: string | undefined | null): string {
  if (!iso) return '';
  const d = new Date(iso.length === 10 ? iso + 'T00:00:00+05:30' : iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata' });
}

export function daysUntil(isoDate: string | undefined | null): number | null {
  if (!isoDate) return null;
  const end = new Date(isoDate + 'T23:59:59+05:30').getTime();
  if (isNaN(end)) return null;
  return Math.ceil((end - Date.now()) / 86_400_000);
}

export const VEHICLE_LABELS = {
  bike: 'Bike',
  auto: 'Auto',
  erickshaw: 'E-rickshaw',
  car: 'Car',
} as const;

/** Turns DD/MM/YYYY (also with - or .) into YYYY-MM-DD, or null if it is not a real date. */
export function parseIndianDate(input: string): string | null {
  const m = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/.exec(input.trim());
  if (!m) return null;
  const dd = Number(m[1]);
  const mm = Number(m[2]);
  const yy = Number(m[3]);
  const dt = new Date(Date.UTC(yy, mm - 1, dd));
  if (dt.getUTCFullYear() !== yy || dt.getUTCMonth() !== mm - 1 || dt.getUTCDate() !== dd) return null;
  return `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

/** DD/MM/YYYY, hh:mm am/pm in Indian time. */
export function formatDateTime(iso: string | undefined | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const date = d.toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata' });
  const time = d.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true });
  return `${date}, ${time}`;
}
