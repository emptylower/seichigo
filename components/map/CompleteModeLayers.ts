/**
 * Complete Mode map layers — GeoJSON source with priority-based zoom filtering.
 *
 * Provides:
 * - A single GeoJSON source for all points (no Supercluster)
 * - A circle "dots" layer as colored fallback
 * - A symbol "icons" layer with sprite-based markers
 * - An optional symbol layer for bangumi cover avatars
 * - Both point layers share a 20-tier zoom-step filter on `priority`
 * - Label layer helpers (unchanged)
 */

import type * as maplibregl from 'maplibre-gl';

// ---------------------------------------------------------------------------
// Source & Layer IDs
// ---------------------------------------------------------------------------
export const COMPLETE_POINTS_SOURCE_ID = 'complete-points';
export const COMPLETE_DOTS_LAYER_ID = 'complete-dots';
export const COMPLETE_ICONS_LAYER_ID = 'complete-icons';
export const COMPLETE_BANGUMI_COVERS_SOURCE_ID = 'complete-bangumi-covers-source';
export const COMPLETE_BANGUMI_COVERS_LAYER_ID = 'complete-bangumi-covers';

const LABEL_SOURCE_ID = 'complete-labels';
const LABEL_LAYER_ID = 'complete-label-layer';

const EMPTY_FC: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [],
};

// ---------------------------------------------------------------------------
// 20-tier zoom-step priority filter (from Anitabi)
//
// At low zoom only high-priority (isolated) points are shown.
// As zoom increases, the threshold decreases until zoom 19 shows everything.
// ---------------------------------------------------------------------------
export const ZOOM_PRIORITY_FILTER: maplibregl.FilterSpecification = [
  'step',
  ['zoom'],
  // default (zoom < 3): only priority > 48000
  ['>', ['get', 'priority'], 48000],
  3, ['>', ['get', 'priority'], 24000],
  4, ['>', ['get', 'priority'], 12000],
  5, ['>', ['get', 'priority'], 6000],
  6, ['>', ['get', 'priority'], 3000],
  7, ['>', ['get', 'priority'], 1600],
  8, ['>', ['get', 'priority'], 800],
  9, ['>', ['get', 'priority'], 400],
  10, ['>', ['get', 'priority'], 200],
  11, ['>', ['get', 'priority'], 100],
  12, ['>', ['get', 'priority'], 50],
  13, ['>', ['get', 'priority'], 20],
  14, ['>', ['get', 'priority'], 10],
  15, ['>', ['get', 'priority'], 5],
  16, ['>', ['get', 'priority'], 3],
  17, ['>', ['get', 'priority'], 2],
  18, ['>', ['get', 'priority'], 1],
  19, true,
] as unknown as maplibregl.FilterSpecification;

// ---------------------------------------------------------------------------
// Source spec builder
// ---------------------------------------------------------------------------
export function buildCompleteSourceSpec(): maplibregl.GeoJSONSourceSpecification {
  return {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  };
}

// ---------------------------------------------------------------------------
// Dots layer spec (circle fallback for colored dots)
// ---------------------------------------------------------------------------
export function buildDotsLayerSpec(): maplibregl.LayerSpecification {
  return {
    id: COMPLETE_DOTS_LAYER_ID,
    type: 'circle',
    source: COMPLETE_POINTS_SOURCE_ID,
    filter: ZOOM_PRIORITY_FILTER,
    paint: {
      'circle-radius': 4,
      'circle-color': ['get', 'color'],
      'circle-stroke-width': 1,
      'circle-stroke-color': '#fff',
    },
  } as maplibregl.LayerSpecification;
}

// ---------------------------------------------------------------------------
// Symbol layer spec (icon markers with priority filter)
// ---------------------------------------------------------------------------
export function buildSymbolLayerSpec(): maplibregl.LayerSpecification {
  return {
    id: COMPLETE_ICONS_LAYER_ID,
    type: 'symbol',
    source: COMPLETE_POINTS_SOURCE_ID,
    filter: ZOOM_PRIORITY_FILTER,
    layout: {
      'icon-image': ['get', 'icon'],
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
      'icon-anchor': 'bottom',
      'icon-offset': [0, 0],
    },
    paint: {
      'icon-opacity': 1,
    },
  } as maplibregl.LayerSpecification;
}

// ---------------------------------------------------------------------------
// Map interaction helpers
// ---------------------------------------------------------------------------

/** Add complete mode sources to map if absent. */
export function ensureCompleteModeSources(map: maplibregl.Map): void {
  if (!map.getSource(COMPLETE_POINTS_SOURCE_ID)) {
    map.addSource(COMPLETE_POINTS_SOURCE_ID, buildCompleteSourceSpec());
  }

  if (!map.getSource(COMPLETE_BANGUMI_COVERS_SOURCE_ID)) {
    map.addSource(COMPLETE_BANGUMI_COVERS_SOURCE_ID, {
      type: 'geojson',
      data: EMPTY_FC,
    });
  }
}

/** Add point layers if absent. */
export function ensureCompleteModeSymbolLayer(map: maplibregl.Map): void {
  if (!map.getLayer(COMPLETE_DOTS_LAYER_ID)) {
    map.addLayer(buildDotsLayerSpec());
  }
  if (!map.getLayer(COMPLETE_ICONS_LAYER_ID)) {
    map.addLayer(buildSymbolLayerSpec());
  }
  if (!map.getLayer(COMPLETE_BANGUMI_COVERS_LAYER_ID)) {
    map.addLayer({
      id: COMPLETE_BANGUMI_COVERS_LAYER_ID,
      type: 'symbol',
      source: COMPLETE_BANGUMI_COVERS_SOURCE_ID,
      minzoom: 5.2,
      filter: ['!=', ['get', 'coverImageId'], ''],
      layout: {
        'icon-image': ['get', 'coverImageId'],
        'icon-size': ['interpolate', ['linear'], ['zoom'], 5.2, 0.24, 7, 0.28, 9, 0.34, 11, 0.4, 12.8, 0.46, 16, 0.52, 20, 0.56],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
      paint: {
        'icon-opacity': 0.95,
      },
    } as maplibregl.LayerSpecification);
  }
}

/** Update the point source data with new features. */
export function updateCompleteModeSources(
  map: maplibregl.Map,
  featureCollection: GeoJSON.FeatureCollection,
): void {
  const source = map.getSource(COMPLETE_POINTS_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
  if (source) {
    source.setData(featureCollection);
  }
}

/** Update the bangumi cover source for loaded cover images. */
export function updateCompleteModeCoverSource(
  map: maplibregl.Map,
  features: GeoJSON.FeatureCollection,
  loadedCoverIds: Set<string>,
): void {
  const coverFeatures: GeoJSON.Feature[] = features.features.map((f) => {
    const bangumiIdRaw = (f.properties as Record<string, unknown>)?.bangumiId;
    const bangumiId = typeof bangumiIdRaw === 'number'
      ? bangumiIdRaw
      : typeof bangumiIdRaw === 'string'
        ? Number.parseInt(bangumiIdRaw, 10)
        : Number.NaN;

    const imageId = Number.isFinite(bangumiId) ? `cover-${bangumiId}` : '';
    return {
      ...f,
      properties: {
        ...f.properties,
        coverImageId: imageId && loadedCoverIds.has(imageId) ? imageId : '',
      },
    };
  });

  const source = map.getSource(COMPLETE_BANGUMI_COVERS_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
  if (source) {
    source.setData({ type: 'FeatureCollection', features: coverFeatures });
  }
}

/** Remove complete mode layers and sources from the map. */
export function removeCompleteModeLayers(map: maplibregl.Map): void {
  if (map.getLayer(COMPLETE_BANGUMI_COVERS_LAYER_ID)) {
    map.removeLayer(COMPLETE_BANGUMI_COVERS_LAYER_ID);
  }
  if (map.getLayer(COMPLETE_ICONS_LAYER_ID)) {
    map.removeLayer(COMPLETE_ICONS_LAYER_ID);
  }
  if (map.getLayer(COMPLETE_DOTS_LAYER_ID)) {
    map.removeLayer(COMPLETE_DOTS_LAYER_ID);
  }
  if (map.getSource(COMPLETE_BANGUMI_COVERS_SOURCE_ID)) {
    map.removeSource(COMPLETE_BANGUMI_COVERS_SOURCE_ID);
  }
  if (map.getSource(COMPLETE_POINTS_SOURCE_ID)) {
    map.removeSource(COMPLETE_POINTS_SOURCE_ID);
  }
}

// ---------------------------------------------------------------------------
// Label layer helpers (preserved from original)
// ---------------------------------------------------------------------------

/** Build a FeatureCollection for label points. */
export function buildLabelFeatureCollection(
  labels: Array<{ lng: number; lat: number; text: string }>,
): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: labels.map((l) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [l.lng, l.lat] },
      properties: { text: l.text },
    })),
  };
}

/** Add label source + layer to map if absent. */
export function ensureLabelLayer(map: maplibregl.Map): void {
  if (!map.getSource(LABEL_SOURCE_ID)) {
    map.addSource(LABEL_SOURCE_ID, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
  }
  if (!map.getLayer(LABEL_LAYER_ID)) {
    map.addLayer({
      id: LABEL_LAYER_ID,
      type: 'symbol',
      source: LABEL_SOURCE_ID,
      layout: {
        'text-field': ['get', 'text'],
        'text-size': 12,
        'text-anchor': 'top',
        'text-offset': [0, 0.5],
      },
      paint: {
        'text-color': '#333',
        'text-halo-color': '#fff',
        'text-halo-width': 1,
      },
    } as maplibregl.LayerSpecification);
  }
}

/** Update label source data. */
export function updateLabelSource(
  map: maplibregl.Map,
  featureCollection: GeoJSON.FeatureCollection,
): void {
  const source = map.getSource(LABEL_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
  if (source) {
    source.setData(featureCollection);
  }
}

/** Remove label layer and source from the map. */
export function removeLabelLayer(map: maplibregl.Map): void {
  if (map.getLayer(LABEL_LAYER_ID)) {
    map.removeLayer(LABEL_LAYER_ID);
  }
  if (map.getSource(LABEL_SOURCE_ID)) {
    map.removeSource(LABEL_SOURCE_ID);
  }
}
