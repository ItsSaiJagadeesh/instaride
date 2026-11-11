/*
 * InstaRide: a fork of RideFlow (GPL-3.0-or-later).
 * Fare maths. Rupees and kilometres. All amounts are rounded to whole rupees.
 */
import type { FareBreakdown, PlatformConfig, VehicleType } from "@shared/schema";

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export interface FareQuote extends FareBreakdown {
  distance: number; // km, estimated road distance
  duration: number; // minutes
}

export function quoteFare(
  config: PlatformConfig,
  vehicleType: VehicleType,
  straightKm: number,
): FareQuote {
  const rate = config.rates[vehicleType];
  const distance = straightKm * config.roadFactor;
  const duration = distance * config.minutesPerKm;
  const distanceFare = distance * rate.perKm;
  const timeFare = duration * rate.perMinute;
  let total = Math.max(rate.baseFare + distanceFare + timeFare, rate.minimumFare);
  if (config.surgePricing) total *= config.surgeMultiplier;
  const totalFare = Math.round(total);
  const platformFee = Math.min(config.platformFeePerRide, totalFare);
  return {
    baseFare: Math.round(rate.baseFare),
    distanceFare: Math.round(distanceFare),
    timeFare: Math.round(timeFare),
    totalFare,
    platformFee,
    driverEarnings: totalFare - platformFee,
    distance: Math.round(distance * 10) / 10,
    duration: Math.round(duration),
  };
}
