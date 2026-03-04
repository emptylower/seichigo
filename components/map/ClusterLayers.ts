import type maplibregl from 'maplibre-gl';
import { LOD_THUMBNAILS_MIN_ZOOM } from '@/components/map/utils/clusterEngine';
import { COMPLETE_POINTS_SOURCE_ID } from '@/components/map/CompleteModeLayers';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const CLUSTER_CIRCLE_LAYER_ID = 'complete-clusters';
export const CLUSTER_COUNT_LAYER_ID = 'complete-cluster-count';

/** Brand pink (#ec4899) used for cluster circles. */
const CLUSTER_COLOR = '#ec4899';

// ---------------------------------------------------------------------------
// ensureClusterLayers
// ---------------------------------------------------------------------------

/**
 * Creates cluster visualization layers on the `complete-points` source.
 *
 * - `complete-clusters` — circle layer sized by `point_count` step expression
 * - `complete-cluster-count` — symbol layer showing `point_count_abbreviated`
 *
 * Idempotent: no-ops if the layers already exist.
 */
export function ensureClusterLayers(map: maplibregl.Map): void {
  const hasCircle = Boolean(map.getLayer(CLUSTER_CIRCLE_LAYER_ID));
  const hasCount = Boolean(map.getLayer(CLUSTER_COUNT_LAYER_ID));
  if (hasCircle && hasCount) return;

  // Cluster circle layer — sized by point_count step expression
  if (!hasCircle) {
    map.addLayer({
      id: CLUSTER_CIRCLE_LAYER_ID,
      type: 'circle',
      source: COMPLETE_POINTS_SOURCE_ID,
      filter: ['has', 'point_count'],
      paint: {
        'circle-color': CLUSTER_COLOR,
        'circle-radius': [
          'step',
          ['get', 'point_count'],
          15, // default: <10 points
          10,
          20, // 10–29 points
          30,
          25, // 30–99 points
          100,
          30, // 100+ points
        ],
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 2,
        'circle-opacity': 0.9,
      },
    } as maplibregl.LayerSpecification);
  }

  // Cluster count label layer
  if (!hasCount) {
    map.addLayer({
      id: CLUSTER_COUNT_LAYER_ID,
      type: 'symbol',
      source: COMPLETE_POINTS_SOURCE_ID,
      filter: ['has', 'point_count'],
      layout: {
        'text-field': ['get', 'point_count_abbreviated'],
        'text-size': 12,
        'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
        'text-allow-overlap': true,
      },
      paint: {
        'text-color': '#ffffff',
      },
    } as maplibregl.LayerSpecification);
  }
}

// ---------------------------------------------------------------------------
// removeClusterLayers
// ---------------------------------------------------------------------------

/**
 * Removes cluster visualization layers. Safe to call even if layers don't exist.
 * Removes count layer first (top), then circle layer (bottom).
 */
export function removeClusterLayers(map: maplibregl.Map): void {
  if (map.getLayer(CLUSTER_COUNT_LAYER_ID)) {
    map.removeLayer(CLUSTER_COUNT_LAYER_ID);
  }
  if (map.getLayer(CLUSTER_CIRCLE_LAYER_ID)) {
    map.removeLayer(CLUSTER_CIRCLE_LAYER_ID);
  }
}

// ---------------------------------------------------------------------------
// getClusterExpansionTarget
// ---------------------------------------------------------------------------

export interface ClusterExpansionTarget {
  center: { lng: number; lat: number };
  zoom: number;
}

interface ClusterFeatureLike {
  properties: {
    cluster_id: number;
    [key: string]: unknown;
  };
  geometry: {
    coordinates: [number, number];
  };
}

interface ClusterEngineLike {
  getClusterExpansionZoom(clusterId: number): number;
}

/**
 * Returns the target center and zoom for a cluster expand (click-to-zoom).
 * Caps zoom at `LOD_THUMBNAILS_MIN_ZOOM` to stay within the cluster LOD range.
 */
export function getClusterExpansionTarget(
  feature: ClusterFeatureLike,
  clusterEngine: ClusterEngineLike,
): ClusterExpansionTarget {
  const clusterId = feature.properties.cluster_id;
  const rawZoom = clusterEngine.getClusterExpansionZoom(clusterId);
  const zoom = Math.min(rawZoom, LOD_THUMBNAILS_MIN_ZOOM);
  const [lng, lat] = feature.geometry.coordinates;

  return { center: { lng, lat }, zoom };
}
