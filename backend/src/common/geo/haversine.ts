import { EARTH_RADIUS_M } from '../constants';

function toRad(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export function distanceMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function isInsideGeofence(input: {
  lat: number;
  lng: number;
  centerLat: number;
  centerLng: number;
  radiusM: number;
}): boolean {
  return distanceMeters(input.lat, input.lng, input.centerLat, input.centerLng) <= input.radiusM;
}
