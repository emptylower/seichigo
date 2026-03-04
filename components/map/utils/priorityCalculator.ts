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
 * Strategy:
 * - Small datasets: exact nearest-neighbor scan (O(n²))
 * - Large datasets: approximate nearest-neighbor via multi-axis sorted window scan (near O(n))
 */

const EARTH_RADIUS_M = 6_371_000; // meters
const METERS_PER_DEGREE = 111_320;
const EXACT_PRIORITY_MAX_POINTS = 1_800;
const APPROX_NEIGHBOR_WINDOW = 12;

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

  if (n <= EXACT_PRIORITY_MAX_POINTS) {
    const priorities: number[] = new Array(n);
    for (let i = 0; i < n; i++) {
      let minDist = Infinity;
      const pi = points[i]!;
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const pj = points[j]!;
        const d = haversineDistance(pi.lat, pi.lng, pj.lat, pj.lng);
        if (d < minDist) minDist = d;
      }
      priorities[i] = Math.ceil(minDist);
    }
    return priorities;
  }

  // Approximate path for large datasets:
  // 1) Project to planar meters (stable for city/country-scale rendering).
  // 2) Scan nearby neighbors in multiple sorted orders (x, y, x+y, x-y).
  // This avoids the O(n²) blow-up while preserving useful priority stratification.
  let sumLat = 0;
  for (let i = 0; i < n; i++) {
    sumLat += points[i]!.lat;
  }
  const meanLatRad = (sumLat / n) * (Math.PI / 180);
  const metersPerLng = METERS_PER_DEGREE * Math.max(0.1, Math.cos(meanLatRad));

  type ProjectedPoint = {
    index: number;
    x: number;
    y: number;
  };
  const projected: ProjectedPoint[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const point = points[i]!;
    projected[i] = {
      index: i,
      x: point.lng * metersPerLng,
      y: point.lat * METERS_PER_DEGREE,
    };
  }

  const minDistSq: number[] = new Array(n).fill(Infinity);
  const scan = (sorted: ReadonlyArray<ProjectedPoint>) => {
    for (let i = 0; i < sorted.length; i++) {
      const current = sorted[i]!;
      const from = Math.max(0, i - APPROX_NEIGHBOR_WINDOW);
      const to = Math.min(sorted.length - 1, i + APPROX_NEIGHBOR_WINDOW);
      for (let j = from; j <= to; j++) {
        if (j === i) continue;
        const candidate = sorted[j]!;
        const dx = current.x - candidate.x;
        const dy = current.y - candidate.y;
        const distSq = dx * dx + dy * dy;
        if (distSq < minDistSq[current.index]) {
          minDistSq[current.index] = distSq;
        }
      }
    }
  };

  scan([...projected].sort((a, b) => a.x - b.x));
  scan([...projected].sort((a, b) => a.y - b.y));
  scan([...projected].sort((a, b) => (a.x + a.y) - (b.x + b.y)));
  scan([...projected].sort((a, b) => (a.x - a.y) - (b.x - b.y)));

  return minDistSq.map((distSq) => (
    Number.isFinite(distSq) ? Math.ceil(Math.sqrt(distSq)) : Infinity
  ));
}
