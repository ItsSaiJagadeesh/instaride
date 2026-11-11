/*
 * InstaRide: a fork of RideFlow (GPL-3.0-or-later).
 * The default build is ONE app, "InstaRide", with both roles: people choose Rider or Driver when they
 * sign up or sign in. EXPO_PUBLIC_APP_VARIANT can still build a rider-only or driver-only app:
 *   rider  -> the InstaRider app
 *   driver -> the InstaDriver app
 *   (unset) -> the single InstaRide app with both roles
 * The Super Admin uses the web console at /console, never the phone app.
 */
export type AppVariant = 'all' | 'rider' | 'driver';
type Role = 'rider' | 'driver';

const raw = process.env.EXPO_PUBLIC_APP_VARIANT;
export const APP_VARIANT: AppVariant = raw === 'rider' || raw === 'driver' ? raw : 'all';

export const APP_TITLE =
  APP_VARIANT === 'rider' ? 'InstaRider' : APP_VARIANT === 'driver' ? 'InstaDriver' : 'InstaRide';

export function roleAllowed(role: Role | 'admin'): boolean {
  if (role === 'admin') return false;
  if (APP_VARIANT === 'all') return true;
  return role === APP_VARIANT;
}
