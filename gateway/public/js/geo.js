export const MAX_ACCURACY_METERS = 50;

const EARTH_RADIUS_METERS = 6371000;
const toRad = (deg) => (deg * Math.PI) / 180;
const toDeg = (rad) => (rad * 180) / Math.PI;

// Khoảng cách đường chim bay (haversine), đơn vị mét.
export function distanceMeters(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(h));
}

// Hướng từ a tới b, độ, 0 = bắc, 90 = đông, trong khoảng [0, 360).
export function bearingDegrees(a, b) {
  const dLng = toRad(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(toRad(b.lat));
  const x = Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) - Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

export function isInside(pos, poi) {
  return distanceMeters(pos, poi) <= poi.radius;
}

export function isAccurateEnough(accuracy) {
  return Number.isFinite(accuracy) && accuracy <= MAX_ACCURACY_METERS;
}
