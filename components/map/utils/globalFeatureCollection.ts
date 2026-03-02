/**
 * Global feature collection builder with priority calculation.
 *
 * Transforms raw point data into a GeoJSON FeatureCollection with:
 * - Coordinate swap (lat,lng → lng,lat for GeoJSON spec)
 * - Distance-based priority calculation
 * - Icon placeholder for future sprite integration
 * - All original point properties preserved
 */

import { calculatePriority } from './priorityCalculator';

export interface InputPoint {
  lat: number;
  lng: number;
  bangumiId: string;
  color: string;
  pointId: string;
}

export interface FeatureProperties {
  priority: number;
  icon: string;
  bangumiId: string;
  color: string;
  pointId: string;
}

export interface Feature {
  type: 'Feature';
  geometry: {
    type: 'Point';
    coordinates: [number, number]; // [lng, lat]
  };
  properties: FeatureProperties;
}

export interface FeatureCollection {
  type: 'FeatureCollection';
  features: Feature[];
}

/**
 * Create a GeoJSON FeatureCollection from raw point data.
 *
 * - Calculates distance-based priority for all points
 * - Swaps coordinates from lat,lng to lng,lat (GeoJSON spec)
 * - Adds empty icon placeholder for future sprite integration
 * - Preserves all input properties (bangumiId, color, pointId)
 *
 * @param points - Array of input points with lat, lng, bangumiId, color, pointId
 * @returns GeoJSON FeatureCollection with priority-enriched features
 */
export function createGlobalFeatureCollection(
  points: ReadonlyArray<InputPoint>,
): FeatureCollection {
  if (points.length === 0) {
    return {
      type: 'FeatureCollection',
      features: [],
    };
  }

  // Calculate priority for all points
  const priorities = calculatePriority(
    points.map((p) => ({ lng: p.lng, lat: p.lat })),
  );

  // Build features with swapped coordinates and enriched properties
  const features: Feature[] = points.map((point, i) => ({
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: [point.lng, point.lat], // GeoJSON: [lng, lat]
    },
    properties: {
      priority: priorities[i],
      icon: '', // Placeholder for sprite integration (Task 8)
      bangumiId: point.bangumiId,
      color: point.color,
      pointId: point.pointId,
    },
  }));

  return {
    type: 'FeatureCollection',
    features,
  };
}
