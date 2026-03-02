/**
 * Distance-based spatial priority calculator.
 *
 * Determines point visibility priority based on proximity to nearest neighbor.
 * Points that are far from all others get high priority (visible at low zoom),
 * while clustered points get low priority (visible only at high zoom).
 *
 * Algorithm matches Anitabi's approach:
 *   priority = ceil(haversineDistance to nearest neighbor)
 *
 * Complexity: O(n²) — intentionally simple, no spatial indexing.
 */

const EARTH_RADIUS_M = 6_371_000; // meters

/**
 * Calculate the great-circle distance between two points using the Haversine formula.
 *
 * @param lat1 - Latitude of point 1 in degrees
 * @param lng1 - Longitude of point 1 in degrees
 * @param lat2 - Latitude of point 2 in degrees
 * @param lng2 - Longitude of point 2 in degrees
 * @returns Distance in meters
 */
export function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return EARTH_RADIUS_M * c;
}

/**
 * Calculate distance-based priority for an array of geographic points.
 *
 * For each point, finds the minimum Haversine distance to any other point.
 * The priority value equals `ceil(minDistance)` in meters.
 *
 * - Single point → `Infinity` (always visible)
 * - Identical coordinates → `0` (lowest priority)
 * - Empty array → empty array
 *
 * @param points - Array of `{ lng, lat }` coordinate objects
 * @returns Array of integer priority values (same order as input)
 */
export function calculatePriority(
  points: ReadonlyArray<{ lng: number; lat: number }>,
): number[] {
  const n = points.length;
  if (n === 0) return [];
  if (n === 1) return [Infinity];

  const priorities: number[] = new Array(n);

  for (let i = 0; i < n; i++) {
    let minDist = Infinity;
    const pi = points[i];

    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const pj = points[j];
      const d = haversineDistance(pi.lat, pi.lng, pj.lat, pj.lng);
      if (d < minDist) minDist = d;
    }

    priorities[i] = Math.ceil(minDist);
  }

  return priorities;
}
