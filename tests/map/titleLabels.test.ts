import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  COMPLETE_LABELS_SOURCE_ID,
  COMPLETE_LABELS_LAYER_ID,
  buildLabelFeatureCollection,
  ensureLabelLayer,
  updateLabelSource,
  removeLabelLayer,
} from '@/components/map/CompleteModeLayers';
import { LOD_ICONS_MAX_ZOOM } from '@/components/map/utils/clusterEngine';

// ---------------------------------------------------------------------------
// Mock MapLibre Map (reuses same pattern as completeModeLayers.test.ts)
// ---------------------------------------------------------------------------

interface MockLayer {
  id: string;
  type: string;
  source: string;
  paint?: Record<string, unknown>;
  layout?: Record<string, unknown>;
  minzoom?: number;
  maxzoom?: number;
}

interface MockSource {
  type: string;
  data?: GeoJSON.FeatureCollection | GeoJSON.Feature;
  setData?: ReturnType<typeof vi.fn>;
}

function createMockMap() {
  const sources = new Map<string, MockSource>();
  const layers = new Map<string, MockLayer>();

  const map = {
    getSource: vi.fn((id: string) => sources.get(id) ?? null),
    getLayer: vi.fn((id: string) => layers.get(id) ?? null),
    addSource: vi.fn((id: string, spec: MockSource) => {
      sources.set(id, {
        ...spec,
        setData: vi.fn((data: GeoJSON.FeatureCollection) => {
          const s = sources.get(id);
          if (s) s.data = data;
        }),
      });
    }),
    addLayer: vi.fn((spec: MockLayer) => {
      layers.set(spec.id, spec);
    }),
    removeLayer: vi.fn((id: string) => {
      layers.delete(id);
    }),
    removeSource: vi.fn((id: string) => {
      sources.delete(id);
    }),
    _sources: sources,
    _layers: layers,
  };

  return map;
}

type MockMap = ReturnType<typeof createMockMap>;

// ---------------------------------------------------------------------------
// Sample bangumi cards
// ---------------------------------------------------------------------------

function sampleCards() {
  return [
    {
      id: 1,
      title: 'Your Name',
      titleZh: '你的名字。',
      color: '#e84393',
      geo: [35.6762, 139.6503] as [number, number], // Tokyo [lat, lng]
    },
    {
      id: 2,
      title: 'Weathering With You',
      titleZh: '天气之子',
      color: '#0984e3',
      geo: [35.6895, 139.6917] as [number, number],
    },
    {
      id: 3,
      title: 'No Geo Anime',
      titleZh: '无坐标',
      color: '#00b894',
      geo: null, // Should be skipped
    },
  ];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Title Label Layer', () => {
  let map: MockMap;

  beforeEach(() => {
    map = createMockMap();
  });

  // ---- buildLabelFeatureCollection ----

  describe('buildLabelFeatureCollection', () => {
    it('creates features with title and color properties', () => {
      const fc = buildLabelFeatureCollection(sampleCards());

      expect(fc.type).toBe('FeatureCollection');
      // 3 cards but one has no geo -> 2 features
      expect(fc.features).toHaveLength(2);

      const props0 = fc.features[0].properties!;
      expect(props0.title).toBe('你的名字。');
      expect(props0.color).toBe('#e84393');

      const props1 = fc.features[1].properties!;
      expect(props1.title).toBe('天气之子');
      expect(props1.color).toBe('#0984e3');
    });

    it('places labels at bangumi centroid with geo swapped to [lng, lat]', () => {
      const fc = buildLabelFeatureCollection(sampleCards());

      const geom0 = fc.features[0].geometry as GeoJSON.Point;
      // Input geo: [35.6762, 139.6503] (lat, lng)
      // Output coordinates: [139.6503, 35.6762] (lng, lat)
      expect(geom0.coordinates).toEqual([139.6503, 35.6762]);

      const geom1 = fc.features[1].geometry as GeoJSON.Point;
      expect(geom1.coordinates).toEqual([139.6917, 35.6895]);
    });

    it('skips bangumis without geo', () => {
      const cards = [
        { id: 1, title: 'A', titleZh: null, color: null, geo: null },
        { id: 2, title: 'B', titleZh: null, color: null, geo: null },
      ];
      const fc = buildLabelFeatureCollection(cards);
      expect(fc.features).toHaveLength(0);
    });

    it('falls back to romaji title when titleZh is null', () => {
      const cards = [
        {
          id: 1,
          title: 'Kimi no Na wa',
          titleZh: null,
          color: '#ff0000',
          geo: [35.0, 139.0] as [number, number],
        },
      ];
      const fc = buildLabelFeatureCollection(cards);
      expect(fc.features[0].properties!.title).toBe('Kimi no Na wa');
    });

    it('uses default color when card color is null', () => {
      const cards = [
        {
          id: 1,
          title: 'Test',
          titleZh: '测试',
          color: null,
          geo: [35.0, 139.0] as [number, number],
        },
      ];
      const fc = buildLabelFeatureCollection(cards);
      expect(fc.features[0].properties!.color).toBe('#6d28d9');
    });

    it('handles empty card array', () => {
      const fc = buildLabelFeatureCollection([]);
      expect(fc.features).toHaveLength(0);
    });
  });

  // ---- ensureLabelLayer ----

  describe('ensureLabelLayer', () => {
    it('creates label source and layer', () => {
      ensureLabelLayer(map as any);

      expect(map._sources.has(COMPLETE_LABELS_SOURCE_ID)).toBe(true);
      expect(map._layers.has(COMPLETE_LABELS_LAYER_ID)).toBe(true);
    });

    it('label layer uses text-field from title property', () => {
      ensureLabelLayer(map as any);

      const layer = map._layers.get(COMPLETE_LABELS_LAYER_ID)!;
      expect(layer.layout!['text-field']).toEqual(['get', 'title']);
    });

    it('label layer uses text-color from color property', () => {
      ensureLabelLayer(map as any);

      const layer = map._layers.get(COMPLETE_LABELS_LAYER_ID)!;
      expect(layer.paint!['text-color']).toEqual(['get', 'color']);
    });

    it('label visible between zoom 8 and LOD_ICONS_MAX_ZOOM (14)', () => {
      ensureLabelLayer(map as any);

      const layer = map._layers.get(COMPLETE_LABELS_LAYER_ID)!;
      expect(layer.minzoom).toBe(8);
      expect(layer.maxzoom).toBe(LOD_ICONS_MAX_ZOOM);
    });

    it('label has text halo for readability', () => {
      ensureLabelLayer(map as any);

      const layer = map._layers.get(COMPLETE_LABELS_LAYER_ID)!;
      const paint = layer.paint!;
      expect(paint['text-halo-color']).toBe('#ffffff');
      expect(paint['text-halo-width']).toBeGreaterThan(0);
    });

    it('label has font size interpolated by zoom', () => {
      ensureLabelLayer(map as any);

      const layer = map._layers.get(COMPLETE_LABELS_LAYER_ID)!;
      const textSize = layer.layout!['text-size'] as unknown[];
      // Should be an interpolation expression
      expect(textSize[0]).toBe('interpolate');
    });

    it('is idempotent — does not duplicate on repeated calls', () => {
      ensureLabelLayer(map as any);
      map.addSource.mockClear();
      map.addLayer.mockClear();

      ensureLabelLayer(map as any);
      expect(map.addSource).not.toHaveBeenCalled();
      expect(map.addLayer).not.toHaveBeenCalled();
    });
  });

  // ---- updateLabelSource ----

  describe('updateLabelSource', () => {
    it('updates source data with given feature collection', () => {
      ensureLabelLayer(map as any);
      const fc = buildLabelFeatureCollection(sampleCards());

      updateLabelSource(map as any, fc);

      const src = map._sources.get(COMPLETE_LABELS_SOURCE_ID)!;
      expect(src.setData).toHaveBeenCalledWith(fc);
    });

    it('does not throw when source does not exist', () => {
      const fc = buildLabelFeatureCollection(sampleCards());
      expect(() => updateLabelSource(map as any, fc)).not.toThrow();
    });
  });

  // ---- removeLabelLayer ----

  describe('removeLabelLayer', () => {
    it('removes label layer and source', () => {
      ensureLabelLayer(map as any);

      removeLabelLayer(map as any);

      expect(map._layers.has(COMPLETE_LABELS_LAYER_ID)).toBe(false);
      expect(map._sources.has(COMPLETE_LABELS_SOURCE_ID)).toBe(false);
    });

    it('safe to call when layer/source do not exist', () => {
      expect(() => removeLabelLayer(map as any)).not.toThrow();
      expect(map.removeLayer).not.toHaveBeenCalled();
      expect(map.removeSource).not.toHaveBeenCalled();
    });

    it('safe to call twice', () => {
      ensureLabelLayer(map as any);
      removeLabelLayer(map as any);
      removeLabelLayer(map as any);

      expect(map._layers.size).toBe(0);
      expect(map._sources.size).toBe(0);
    });
  });
});
