import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  COMPLETE_POINTS_SOURCE_ID,
  COMPLETE_THUMBNAILS_SOURCE_ID,
  COMPLETE_DOTS_LAYER_ID,
  COMPLETE_THUMBNAILS_LAYER_ID,
  ensureCompleteModeSources,
  ensureCompleteModePointLayers,
  updateCompleteModeSources,
  removeCompleteModeLayers,
} from '@/components/map/CompleteModeLayers';
import {
  LOD_ICONS_MAX_ZOOM,
  LOD_THUMBNAILS_MIN_ZOOM,
} from '@/components/map/utils/clusterEngine';

// ---------------------------------------------------------------------------
// Mock MapLibre Map
// ---------------------------------------------------------------------------

interface MockLayer {
  id: string;
  type: string;
  source: string;
  paint?: Record<string, unknown>;
  layout?: Record<string, unknown>;
  minzoom?: number;
  maxzoom?: number;
  filter?: unknown[];
}

interface MockSource {
  type: string;
  data?: GeoJSON.FeatureCollection | GeoJSON.Feature;
  setData?: ReturnType<typeof vi.fn>;
}

function createMockMap() {
  const sources = new Map<string, MockSource>();
  const layers = new Map<string, MockLayer>();
  const layerOrder: string[] = [];

  const map = {
    getSource: vi.fn((id: string) => sources.get(id) ?? null),
    getLayer: vi.fn((id: string) => layers.get(id) ?? null),
    addSource: vi.fn((id: string, spec: MockSource) => {
      if (sources.has(id)) throw new Error(`Source "${id}" already exists`);
      sources.set(id, { ...spec, setData: vi.fn((data: GeoJSON.FeatureCollection) => {
        const s = sources.get(id);
        if (s) s.data = data;
      }) });
    }),
    addLayer: vi.fn((spec: MockLayer, before?: string) => {
      if (layers.has(spec.id)) throw new Error(`Layer "${spec.id}" already exists`);
      layers.set(spec.id, spec);
      if (before) {
        const idx = layerOrder.indexOf(before);
        if (idx >= 0) layerOrder.splice(idx, 0, spec.id);
        else layerOrder.push(spec.id);
      } else {
        layerOrder.push(spec.id);
      }
    }),
    removeLayer: vi.fn((id: string) => {
      layers.delete(id);
      const idx = layerOrder.indexOf(id);
      if (idx >= 0) layerOrder.splice(idx, 1);
    }),
    removeSource: vi.fn((id: string) => {
      sources.delete(id);
    }),
    // Expose internals for assertions
    _sources: sources,
    _layers: layers,
    _layerOrder: layerOrder,
  };

  return map;
}

type MockMap = ReturnType<typeof createMockMap>;

function emptyFC(): GeoJSON.FeatureCollection {
  return { type: 'FeatureCollection', features: [] };
}

function sampleFC(count = 3): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (let i = 0; i < count; i++) {
    features.push({
      type: 'Feature',
      properties: { pointId: `pt-${i}`, color: '#ff0000', thumbImageId: '' },
      geometry: { type: 'Point', coordinates: [135 + i * 0.01, 35 + i * 0.01] },
    });
  }
  return { type: 'FeatureCollection', features };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CompleteModeLayers', () => {
  let map: MockMap;

  beforeEach(() => {
    map = createMockMap();
  });

  // ---- ensureCompleteModeSources ----

  describe('ensureCompleteModeSources', () => {
    it('creates both GeoJSON sources when they do not exist', () => {
      ensureCompleteModeSources(map as any);

      expect(map.addSource).toHaveBeenCalledTimes(2);
      expect(map._sources.has(COMPLETE_POINTS_SOURCE_ID)).toBe(true);
      expect(map._sources.has(COMPLETE_THUMBNAILS_SOURCE_ID)).toBe(true);

      const pointSrc = map._sources.get(COMPLETE_POINTS_SOURCE_ID)!;
      expect(pointSrc.type).toBe('geojson');

      const thumbSrc = map._sources.get(COMPLETE_THUMBNAILS_SOURCE_ID)!;
      expect(thumbSrc.type).toBe('geojson');
    });

    it('does not recreate sources when they already exist', () => {
      ensureCompleteModeSources(map as any);
      map.addSource.mockClear();

      // Call again — should be idempotent
      ensureCompleteModeSources(map as any);
      expect(map.addSource).not.toHaveBeenCalled();
    });
  });

  // ---- ensureCompleteModePointLayers ----

  describe('ensureCompleteModePointLayers', () => {
    beforeEach(() => {
      ensureCompleteModeSources(map as any);
    });

    it('creates complete-dots circle layer with correct paint', () => {
      ensureCompleteModePointLayers(map as any);

      const dotsLayer = map._layers.get(COMPLETE_DOTS_LAYER_ID);
      expect(dotsLayer).toBeDefined();
      expect(dotsLayer!.type).toBe('circle');
      expect(dotsLayer!.source).toBe(COMPLETE_POINTS_SOURCE_ID);

      // Paint: circle-radius between 4-6, opacity 0.8, color from feature
      const paint = dotsLayer!.paint!;
      expect(paint['circle-opacity']).toBe(0.8);
      // circle-color should reference feature 'color' property
      expect(paint['circle-color']).toBeDefined();
      // circle-radius should be an interpolation expression
      expect(paint['circle-radius']).toBeDefined();
    });

    it('complete-dots visible only below LOD_ICONS_MAX_ZOOM', () => {
      ensureCompleteModePointLayers(map as any);

      const dotsLayer = map._layers.get(COMPLETE_DOTS_LAYER_ID)!;
      expect(dotsLayer.maxzoom).toBe(LOD_ICONS_MAX_ZOOM);
    });

    it('creates complete-thumbnails symbol layer with data-driven icon-image', () => {
      ensureCompleteModePointLayers(map as any);

      const thumbLayer = map._layers.get(COMPLETE_THUMBNAILS_LAYER_ID);
      expect(thumbLayer).toBeDefined();
      expect(thumbLayer!.type).toBe('symbol');
      expect(thumbLayer!.source).toBe(COMPLETE_THUMBNAILS_SOURCE_ID);

      const layout = thumbLayer!.layout!;
      // icon-image driven by thumbImageId property
      expect(layout['icon-image']).toEqual(['get', 'thumbImageId']);
      expect(layout['icon-size']).toBe(0.5);
      expect(layout['icon-allow-overlap']).toBe(true);
    });

    it('complete-thumbnails visible at/above LOD_THUMBNAILS_MIN_ZOOM', () => {
      ensureCompleteModePointLayers(map as any);

      const thumbLayer = map._layers.get(COMPLETE_THUMBNAILS_LAYER_ID)!;
      expect(thumbLayer.minzoom).toBe(LOD_THUMBNAILS_MIN_ZOOM);
    });

    it('does not duplicate layers on repeated calls', () => {
      ensureCompleteModePointLayers(map as any);
      map.addLayer.mockClear();

      ensureCompleteModePointLayers(map as any);
      expect(map.addLayer).not.toHaveBeenCalled();
    });
  });

  // ---- updateCompleteModeSources ----

  describe('updateCompleteModeSources', () => {
    beforeEach(() => {
      ensureCompleteModeSources(map as any);
    });

    it('updates point source data', () => {
      const fc = sampleFC(5);
      updateCompleteModeSources(map as any, fc, new Set<string>());

      const pointSrc = map._sources.get(COMPLETE_POINTS_SOURCE_ID)!;
      expect(pointSrc.setData).toHaveBeenCalled();
    });

    it('sets thumbImageId on features whose id is in loadedThumbIds', () => {
      const fc = sampleFC(3);
      const loaded = new Set<string>(['thumb-pt-0', 'thumb-pt-2']);
      updateCompleteModeSources(map as any, fc, loaded);

      const thumbSrc = map._sources.get(COMPLETE_THUMBNAILS_SOURCE_ID)!;
      expect(thumbSrc.setData).toHaveBeenCalled();

      // Inspect the data passed to setData
      const setDataCall = thumbSrc.setData!.mock.calls[0][0] as GeoJSON.FeatureCollection;
      // Only features with loaded thumbs should have a non-empty thumbImageId
      const thumbFeatures = setDataCall.features;
      expect(thumbFeatures.length).toBe(3);

      const feat0 = thumbFeatures.find(
        (f) => (f.properties as any).pointId === 'pt-0'
      )!;
      expect((feat0.properties as any).thumbImageId).toBe('thumb-pt-0');

      const feat1 = thumbFeatures.find(
        (f) => (f.properties as any).pointId === 'pt-1'
      )!;
      expect((feat1.properties as any).thumbImageId).toBe('');

      const feat2 = thumbFeatures.find(
        (f) => (f.properties as any).pointId === 'pt-2'
      )!;
      expect((feat2.properties as any).thumbImageId).toBe('thumb-pt-2');
    });
  });

  // ---- removeCompleteModeLayers ----

  describe('removeCompleteModeLayers', () => {
    it('removes all complete mode layers and sources', () => {
      ensureCompleteModeSources(map as any);
      ensureCompleteModePointLayers(map as any);

      removeCompleteModeLayers(map as any);

      expect(map._layers.has(COMPLETE_DOTS_LAYER_ID)).toBe(false);
      expect(map._layers.has(COMPLETE_THUMBNAILS_LAYER_ID)).toBe(false);
      expect(map._sources.has(COMPLETE_POINTS_SOURCE_ID)).toBe(false);
      expect(map._sources.has(COMPLETE_THUMBNAILS_SOURCE_ID)).toBe(false);
    });

    it('does not throw when layers/sources do not exist', () => {
      // No layers added — should not throw
      expect(() => removeCompleteModeLayers(map as any)).not.toThrow();
      expect(map.removeLayer).not.toHaveBeenCalled();
      expect(map.removeSource).not.toHaveBeenCalled();
    });

    it('is safe to call twice in a row', () => {
      ensureCompleteModeSources(map as any);
      ensureCompleteModePointLayers(map as any);

      removeCompleteModeLayers(map as any);
      removeCompleteModeLayers(map as any);

      // Second call should be a no-op — no errors
      expect(map._layers.size).toBe(0);
      expect(map._sources.size).toBe(0);
    });
  });
});
