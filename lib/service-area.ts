/**
 * Service area logic for InstaRide.
 * Currently configured for Jangareddygudem, Andhra Pradesh.
 * Can be extended to multi-city support.
 */

export interface ServiceArea {
  name: string;
  center: { lat: number; lng: number };
  radiusKm: number;
  cities?: string[];
}

// Define service areas (currently Jangareddygudem)
const SERVICE_AREAS: ServiceArea[] = [
  {
    name: 'Jangareddygudem',
    center: { lat: 17.3521, lng: 80.8341 }, // Approximate center of Jangareddygudem
    radiusKm: 15, // 15 km radius around the city center
    cities: ['Jangareddygudem', 'JRG'],
  },
];

/**
 * Calculate distance between two coordinates using Haversine formula
 * Returns distance in kilometers
 */
export function calculateDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371; // Earth's radius in kilometers
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLng = (lng2 - lng1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Check if a coordinate is within any service area
 */
export function isWithinServiceArea(lat: number, lng: number): boolean {
  return SERVICE_AREAS.some((area) => {
    const distance = calculateDistance(area.center.lat, area.center.lng, lat, lng);
    return distance <= area.radiusKm;
  });
}

/**
 * Check if both pickup and destination are within service area (local ride)
 * or if destination is outside service area (intercity ride)
 */
export function getRideType(
  pickupLat: number,
  pickupLng: number,
  destinationLat: number,
  destinationLng: number
): 'local' | 'intercity' {
  const pickupInArea = isWithinServiceArea(pickupLat, pickupLng);
  const destinationInArea = isWithinServiceArea(destinationLat, destinationLng);

  // If both are in service area, it's a local ride
  if (pickupInArea && destinationInArea) {
    return 'local';
  }

  // Otherwise, it's an intercity ride (destination is outside service area)
  return 'intercity';
}

/**
 * Get the service area name for a coordinate
 */
export function getServiceAreaName(lat: number, lng: number): string | null {
  const area = SERVICE_AREAS.find((a) => {
    const distance = calculateDistance(a.center.lat, a.center.lng, lat, lng);
    return distance <= a.radiusKm;
  });
  return area?.name || null;
}

/**
 * Calculate intercity fare based on distance and vehicle type
 * This is a placeholder; actual pricing should come from backend
 */
export interface IntercityFare {
  baseFare: number;
  distanceFare: number;
  timeFare: number;
  totalFare: number;
  driverEarnings: number;
  platformFee: number;
}

export function calculateIntercityFare(
  distance: number,
  duration: number,
  vehicleType: string
): IntercityFare {
  // Pricing rules (can be configured in backend)
  const baseRates: Record<string, { distancePerKm: number; timePerMin: number; baseFare: number }> = {
    bike: { baseFare: 50, distancePerKm: 15, timePerMin: 1 },
    auto: { baseFare: 80, distancePerKm: 20, timePerMin: 1.5 },
    car: { baseFare: 150, distancePerKm: 25, timePerMin: 2 },
    erickshaw: { baseFare: 60, distancePerKm: 18, timePerMin: 1.2 },
  };

  const rate = baseRates[vehicleType] || baseRates.bike;
  const distanceFare = distance * rate.distancePerKm;
  const durationMinutes = duration / 60; // Convert seconds to minutes
  const timeFare = durationMinutes * rate.timePerMin;
  const totalBeforeFee = rate.baseFare + distanceFare + timeFare;

  // Platform fee: 15% of ride fare
  const platformFee = Math.round(totalBeforeFee * 0.15 * 100) / 100;
  const driverEarnings = totalBeforeFee - platformFee;

  return {
    baseFare: rate.baseFare,
    distanceFare: Math.round(distanceFare * 100) / 100,
    timeFare: Math.round(timeFare * 100) / 100,
    totalFare: Math.round(totalBeforeFee * 100) / 100,
    driverEarnings: Math.round(driverEarnings * 100) / 100,
    platformFee,
  };
}
