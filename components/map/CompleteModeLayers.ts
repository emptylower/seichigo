import type maplibregl from 'maplibre-gl';
import {
  LOD_ICONS_MAX_ZOOM,
  LOD_THUMBNAILS_MIN_ZOOM,
} from '@/components/map/utils/clusterEngine';

// ---------------------------------------------------------------------------
// Layer / Source IDs
// ---------------------------------------------------------------------------

export const COMPLETE_POINTS_SOURCE_ID = 'complete-points';
export const COMPLETE_THUMBNAILS_SOURCE_ID = 'complete-thumbnails';
export const COMPLETE_DOTS_LAYER_ID = 'complete-dots';
export const COMPLETE_THUMBNAILS_LAYER_ID = 'complete-thumbnails';

// ---------------------------------------------------------------------------
// Empty feature collection helper
// ---------------------------------------------------------------------------

const EMPTY_FC: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [],
};

// ---------------------------------------------------------------------------
// ensureCompleteModeSources
// ---------------------------------------------------------------------------

/**
 * Creates the two GeoJSON sources needed by complete mode if they don't
 * already exist:
 * - `complete-points` — drives the dot circle layer
 * - `complete-thumbnails` — drives the thumbnail symbol layer
 */
export function ensureCompleteModeSources(map: maplibregl.Map): void {
  if (!map.getSource(COMPLETE_POINTS_SOURCE_ID)) {
    map.addSource(COMPLETE_POINTS_SOURCE_ID, {
      type: 'geojson',
      data: EMPTY_FC,
    });
  }

  if (!map.getSource(COMPLETE_THUMBNAILS_SOURCE_ID)) {
    map.addSource(COMPLETE_THUMBNAILS_SOURCE_ID, {
      type: 'geojson',
      data: EMPTY_FC,
    });
  }
}

// ---------------------------------------------------------------------------
// ensureCompleteModePointLayers
// ---------------------------------------------------------------------------

/**
 * Creates the visual layers for complete mode if they don't already exist:
 * - `complete-dots` — small colored circles visible at zoom < LOD_ICONS_MAX_ZOOM
 * - `complete-thumbnails` — symbol layer driven by `thumbImageId`, visible at
 *   zoom >= LOD_THUMBNAILS_MIN_ZOOM
 *
 * Layer ordering: these sit BELOW range overlay layers, ABOVE the base map.
 * Since range layers are added later and on top, no explicit `before` is
 * needed — MapLibre stacks layers in add order.
 */
export function ensureCompleteModePointLayers(map: maplibregl.Map): void {
  // --- Dots circle layer ---
  if (!map.getLayer(COMPLETE_DOTS_LAYER_ID)) {
    map.addLayer({
      id: COMPLETE_DOTS_LAYER_ID,
      type: 'circle',
      source: COMPLETE_POINTS_SOURCE_ID,
      maxzoom: LOD_ICONS_MAX_ZOOM,
      paint: {
        'circle-color': ['coalesce', ['get', 'color'], '#6d28d9'],
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 4, 10, 6],
        'circle-opacity': 0.8,
      },
    } as maplibregl.LayerSpecification);
  }

  // --- Thumbnails symbol layer ---
  if (!map.getLayer(COMPLETE_THUMBNAILS_LAYER_ID)) {
    map.addLayer({
      id: COMPLETE_THUMBNAILS_LAYER_ID,
      type: 'symbol',
      source: COMPLETE_THUMBNAILS_SOURCE_ID,
      minzoom: LOD_THUMBNAILS_MIN_ZOOM,
      layout: {
        'icon-image': ['get', 'thumbImageId'],
        'icon-size': 0.5,
        'icon-allow-overlap': true,
      },
    } as maplibregl.LayerSpecification);
  }
}

// ---------------------------------------------------------------------------
// updateCompleteModeSources
// ---------------------------------------------------------------------------

/**
 * Updates both complete-mode sources with the latest feature data.
 *
 * - The `complete-points` source receives the raw feature collection as-is.
 * - The `complete-thumbnails` source receives a copy where each feature's
 *   `thumbImageId` is set to the feature id if that id appears in
 *   `loadedThumbIds`, or empty string otherwise. This drives MapLibre's
 *   data-driven `icon-image` expression.
 */
export function updateCompleteModeSources(
  map: maplibregl.Map,
  features: GeoJSON.FeatureCollection,
  loadedThumbIds: Set<string>,
): void {
  // Update point source
  const pointSource = map.getSource(COMPLETE_POINTS_SOURCE_ID) as maplibregl.GeoJSONSource | null;
  if (pointSource) {
    pointSource.setData(features);
  }

  // Build thumbnail FC with thumbImageId set based on loaded state
  const thumbFeatures: GeoJSON.Feature[] = features.features.map((f) => {
    const pointId = (f.properties as Record<string, unknown>)?.pointId as string ?? '';
    const thumbId = pointId ? `thumb-${pointId}` : '';
    return {
      ...f,
      properties: {
        ...f.properties,
        thumbImageId: loadedThumbIds.has(thumbId) ? thumbId : '',
      },
    };
  });
  const thumbFC: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: thumbFeatures,
  };

  const thumbSource = map.getSource(COMPLETE_THUMBNAILS_SOURCE_ID) as maplibregl.GeoJSONSource | null;
  if (thumbSource) {
    thumbSource.setData(thumbFC);
  }
}

// ---------------------------------------------------------------------------
// removeCompleteModeLayers
// ---------------------------------------------------------------------------

/**
 * Cleanly removes all complete mode layers and sources.
 * Safe to call even if layers/sources don't exist.
 */
export function removeCompleteModeLayers(map: maplibregl.Map): void {
  // Remove layers first (must happen before source removal)
  if (map.getLayer(COMPLETE_DOTS_LAYER_ID)) {
    map.removeLayer(COMPLETE_DOTS_LAYER_ID);
  }
  if (map.getLayer(COMPLETE_THUMBNAILS_LAYER_ID)) {
    map.removeLayer(COMPLETE_THUMBNAILS_LAYER_ID);
  }

  // Remove sources
  if (map.getSource(COMPLETE_POINTS_SOURCE_ID)) {
    map.removeSource(COMPLETE_POINTS_SOURCE_ID);
  }
  if (map.getSource(COMPLETE_THUMBNAILS_SOURCE_ID)) {
    map.removeSource(COMPLETE_THUMBNAILS_SOURCE_ID);
  }
}

// ---------------------------------------------------------------------------
// Label Layer / Source IDs
// ---------------------------------------------------------------------------

export const COMPLETE_LABELS_SOURCE_ID = 'complete-labels';
export const COMPLETE_LABELS_LAYER_ID = 'complete-labels';

/** Min zoom at which anime title labels become visible */
const LABEL_MIN_ZOOM = 8;

// ---------------------------------------------------------------------------
// buildLabelFeatureCollection
// ---------------------------------------------------------------------------

/**
 * Builds a GeoJSON FeatureCollection of label points from bangumi cards.
 *
 * Each feature is placed at the bangumi centroid (`geo` swapped from
 * [lat, lng] → [lng, lat]) and carries `title` (Chinese name, falling back
 * to romaji) and `color` (anime-specific color).
 *
 * Bangumis without `geo` are silently skipped.
 */
export function buildLabelFeatureCollection(
  cards: ReadonlyArray<{
    id: number;
    title: string;
    titleZh: string | null;
    color: string | null;
    geo: [number, number] | null;
  }>,
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];

  for (const card of cards) {
    if (!card.geo) continue;

    // geo is stored as [lat, lng]; GeoJSON needs [lng, lat]
    const [lat, lng] = card.geo;

    features.push({
      type: 'Feature',
      properties: {
        title: card.titleZh || card.title,
        color: card.color || '#6d28d9',
      },
      geometry: {
        type: 'Point',
        coordinates: [lng, lat],
      },
    });
  }

  return { type: 'FeatureCollection', features };
}

// ---------------------------------------------------------------------------
// ensureLabelLayer
// ---------------------------------------------------------------------------

/**
 * Creates the label GeoJSON source and text symbol layer if they don't
 * already exist.
 *
 * Styling:
 * - `text-field` driven by feature `title` property
 * - `text-color` driven by feature `color` property (anime-specific)
 * - White text halo for readability over any background
 * - Font size interpolates by zoom for progressive reveal
 * - Visible between zoom 8 and LOD_ICONS_MAX_ZOOM (14)
 */
export function ensureLabelLayer(map: maplibregl.Map): void {
  if (!map.getSource(COMPLETE_LABELS_SOURCE_ID)) {
    map.addSource(COMPLETE_LABELS_SOURCE_ID, {
      type: 'geojson',
      data: EMPTY_FC,
    });
  }

  if (!map.getLayer(COMPLETE_LABELS_LAYER_ID)) {
    map.addLayer({
      id: COMPLETE_LABELS_LAYER_ID,
      type: 'symbol',
      source: COMPLETE_LABELS_SOURCE_ID,
      minzoom: LABEL_MIN_ZOOM,
      maxzoom: LOD_ICONS_MAX_ZOOM,
      layout: {
        'text-field': ['get', 'title'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 8, 10, 12, 13, 14, 15],
        'text-anchor': 'top',
        'text-offset': [0, 0.8],
        'text-allow-overlap': false,
        'text-optional': true,
      },
      paint: {
        'text-color': ['get', 'color'],
        'text-halo-color': '#ffffff',
        'text-halo-width': 1.5,
        'text-halo-blur': 0.5,
      },
    } as maplibregl.LayerSpecification);
  }
}

// ---------------------------------------------------------------------------
// updateLabelSource
// ---------------------------------------------------------------------------

/**
 * Replaces the label source data with the given feature collection.
 */
export function updateLabelSource(
  map: maplibregl.Map,
  fc: GeoJSON.FeatureCollection,
): void {
  const src = map.getSource(COMPLETE_LABELS_SOURCE_ID) as maplibregl.GeoJSONSource | null;
  if (src) {
    src.setData(fc);
  }
}

// ---------------------------------------------------------------------------
// removeLabelLayer
// ---------------------------------------------------------------------------

/**
 * Removes the label layer and source. Safe to call when they don't exist.
 */
export function removeLabelLayer(map: maplibregl.Map): void {
  if (map.getLayer(COMPLETE_LABELS_LAYER_ID)) {
    map.removeLayer(COMPLETE_LABELS_LAYER_ID);
  }
  if (map.getSource(COMPLETE_LABELS_SOURCE_ID)) {
    map.removeSource(COMPLETE_LABELS_SOURCE_ID);
  }
}
