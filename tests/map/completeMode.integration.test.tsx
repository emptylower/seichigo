import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createGlobalFeatureCollection } from '@/components/map/utils/globalFeatureCollection';
import { cutSpriteSheet } from '@/components/map/utils/spriteRenderer';
import {
  COMPLETE_POINTS_SOURCE_ID,
  COMPLETE_THEME_SOURCE_ID,
  COMPLETE_DOTS_LAYER_ID,
  COMPLETE_ICONS_LAYER_ID,
  buildCompleteSourceSpec,
  buildDotsLayerSpec,
  buildSymbolLayerSpec,
} from '@/components/map/CompleteModeLayers';
import type { AnitabiTheme } from '@/components/map/types';
import type { Map as MapboxMap } from 'maplibre-gl';

// Mock infrastructure
class MockImageData {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.data = new Uint8ClampedArray(width * height * 4);
  }
}

function createMockCtx() {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const record = (method: string) => (...args: unknown[]) => {
    calls.push({ method, args });
  };

  const ctx = {
    drawImage: record('drawImage'),
    fillRect: record('fillRect'),
    fill: record('fill'),
    save: record('save'),
    restore: record('restore'),
    translate: record('translate'),
    scale: record('scale'),
    beginPath: record('beginPath'),
    clip: record('clip'),
    arc: record('arc'),
    closePath: record('closePath'),
    clearRect: record('clearRect'),
    getImageData: vi.fn((x: number, y: number, w: number, h: number) => new MockImageData(w, h)),
    set fillStyle(_v: string) {},
    get fillStyle() { return ''; },
    set globalCompositeOperation(_v: string) {},
    get globalCompositeOperation() { return 'source-over'; },
    _calls: calls,
  };
  return ctx;
}

function createMockCanvas() {
  const ctx = createMockCtx();
  return {
    getContext: vi.fn(() => ctx),
    width: 0,
    height: 0,
    _ctx: ctx,
  };
}

function mockImageLoader(url: string): Promise<HTMLImageElement> {
  const img = {
    width: 100, height: 76,
    naturalWidth: 100, naturalHeight: 76,
    src: url,
  } as unknown as HTMLImageElement;
  return Promise.resolve(img);
}

let lastCanvas: ReturnType<typeof createMockCanvas>;

beforeEach(() => {
  lastCanvas = createMockCanvas();
  vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
    if (tag === 'canvas') return lastCanvas as unknown as HTMLCanvasElement;
    return document.createElement(tag);
  });
  if (typeof globalThis.ImageData === 'undefined') {
    (globalThis as any).ImageData = MockImageData;
  }
  if (typeof globalThis.Path2D === 'undefined') {
    (globalThis as any).Path2D = class Path2D { constructor(_d?: string) {} };
  }
});

// Mock Mapbox Map
interface MockMapState {
  sources: Map<string, any>;
  layers: Map<string, any>;
  images: Map<string, any>;
  style: { loaded: boolean };
}

function createMockMap(): MapboxMap & { _state: MockMapState } {
  const state: MockMapState = {
    sources: new Map(),
    layers: new Map(),
    images: new Map(),
    style: { loaded: true },
  };

  const map = {
    _state: state,
    
    getSource: vi.fn((id: string) => state.sources.get(id)),
    addSource: vi.fn((id: string, spec: any) => {
      state.sources.set(id, spec);
    }),
    removeSource: vi.fn((id: string) => {
      state.sources.delete(id);
    }),
    
    getLayer: vi.fn((id: string) => state.layers.get(id)),
    addLayer: vi.fn((spec: any) => {
      state.layers.set(spec.id, spec);
    }),
    removeLayer: vi.fn((id: string) => {
      state.layers.delete(id);
    }),
    
    hasImage: vi.fn((id: string) => state.images.has(id)),
    addImage: vi.fn((id: string, imageData: any) => {
      state.images.set(id, imageData);
    }),
    removeImage: vi.fn((id: string) => {
      state.images.delete(id);
    }),
    
    isStyleLoaded: vi.fn(() => state.style.loaded),
    
    setLayoutProperty: vi.fn(),
    setPaintProperty: vi.fn(),
  } as unknown as MapboxMap & { _state: MockMapState };

  return map;
}

// Integration Tests
describe('Complete Mode Integration', () => {
  const bangumiId = 12345;
  const color = '#e91e63';

  const makeTheme = (ids: string[], w = 100, h = 76): AnitabiTheme => ({
    ids, src: '/images/ptheme/test_100_76.webp', w, h,
  });

  const makePoints = (count: number) =>
    Array.from({ length: count }, (_, i) => ({
      id: 'pt-' + i, name: 'Point ' + i, nameZh: null,
      geo: [139.0 + i * 0.01, 35.0 + i * 0.01] as [number, number],
      ep: null, s: null, image: null, density: null, note: null,
    }));

  const makeMapPoints = (count: number) =>
    Array.from({ length: count }, (_, i) => ({
      lat: 35.0 + i * 0.01,
      lng: 139.0 + i * 0.01,
      bangumiId: bangumiId.toString(),
      color,
      pointId: 'pt-' + i,
    }));

  describe('Full Pipeline: Features → Priorities → Sprites → Layers', () => {
    it('should execute complete flow from raw points to map layers', async () => {
      const mapPoints = makeMapPoints(3);
      const featureCollection = createGlobalFeatureCollection(mapPoints);

      expect(featureCollection.type).toBe('FeatureCollection');
      expect(featureCollection.features).toHaveLength(3);
      expect(featureCollection.features[0].properties).toHaveProperty('priority');
      expect(featureCollection.features[0].properties).toHaveProperty('icon', '');

      const themeIds = ['a', 'b', 'c'];
      const theme = makeTheme(themeIds);
      // Points must have IDs matching theme.ids for sprite cutting
      const points = themeIds.map((id) => ({ id }));
      const spriteMap = await cutSpriteSheet(bangumiId, theme, points, color, mockImageLoader);

      expect(spriteMap.size).toBe(3);

      const sourceSpec = buildCompleteSourceSpec();
      const dotsLayer = buildDotsLayerSpec();
      const symbolLayer = buildSymbolLayerSpec();

      expect(sourceSpec.type).toBe('geojson');
      expect(dotsLayer.id).toBe(COMPLETE_DOTS_LAYER_ID);
      expect(symbolLayer.id).toBe(COMPLETE_ICONS_LAYER_ID);

      const map = createMockMap();
      map.addSource(COMPLETE_POINTS_SOURCE_ID, sourceSpec);
      map.addSource(COMPLETE_THEME_SOURCE_ID, sourceSpec);
      for (const [key, { imageData }] of spriteMap) {
        map.addImage(key, imageData);
      }
      map.addLayer(dotsLayer);
      map.addLayer(symbolLayer);

      expect(map._state.sources.size).toBe(2);
      expect(map._state.layers.size).toBe(2);
      expect(map._state.images.size).toBe(3);
    });
  });

  describe('Mode Switch Cleanup', () => {
    it('should properly remove all complete mode resources', () => {
      const map = createMockMap();

      map.addSource(COMPLETE_POINTS_SOURCE_ID, buildCompleteSourceSpec());
      map.addSource(COMPLETE_THEME_SOURCE_ID, buildCompleteSourceSpec());
      map.addLayer(buildDotsLayerSpec());
      map.addLayer(buildSymbolLayerSpec());
      map.addImage('sprite-123-pt-0', new MockImageData(100, 89));
      map.addImage('sprite-123-pt-1', new MockImageData(100, 89));

      expect(map._state.sources.size).toBe(2);
      expect(map._state.layers.size).toBe(2);
      expect(map._state.images.size).toBe(2);

      if (map.getLayer(COMPLETE_ICONS_LAYER_ID)) {
        map.removeLayer(COMPLETE_ICONS_LAYER_ID);
      }
      if (map.getLayer(COMPLETE_DOTS_LAYER_ID)) {
        map.removeLayer(COMPLETE_DOTS_LAYER_ID);
      }
      if (map.getSource(COMPLETE_POINTS_SOURCE_ID)) {
        map.removeSource(COMPLETE_POINTS_SOURCE_ID);
      }
      if (map.getSource(COMPLETE_THEME_SOURCE_ID)) {
        map.removeSource(COMPLETE_THEME_SOURCE_ID);
      }
      if (map.hasImage('sprite-123-pt-0')) {
        map.removeImage('sprite-123-pt-0');
      }
      if (map.hasImage('sprite-123-pt-1')) {
        map.removeImage('sprite-123-pt-1');
      }

      expect(map._state.sources.size).toBe(0);
      expect(map._state.layers.size).toBe(0);
      expect(map._state.images.size).toBe(0);
    });
  });

  describe('Style Reload Re-initialization', () => {
    it('should handle style reload by re-adding all resources', async () => {
      const map = createMockMap();
      const mapPoints = makeMapPoints(2);
      const themeIds = ['a', 'b'];
      const theme = makeTheme(themeIds);
      // Points must have IDs matching theme.ids for sprite cutting
      const points = themeIds.map((id) => ({ id }));
      const spriteMap = await cutSpriteSheet(bangumiId, theme, points, color, mockImageLoader);

      map.addSource(COMPLETE_POINTS_SOURCE_ID, buildCompleteSourceSpec());
      map.addSource(COMPLETE_THEME_SOURCE_ID, buildCompleteSourceSpec());
      map.addLayer(buildDotsLayerSpec());
      map.addLayer(buildSymbolLayerSpec());
      for (const [key, { imageData }] of spriteMap) {
        map.addImage(key, imageData);
      }

      map._state.sources.clear();
      map._state.layers.clear();
      map._state.images.clear();
      map._state.style.loaded = false;

      map._state.style.loaded = true;

      if (map.isStyleLoaded() && !map.getSource(COMPLETE_POINTS_SOURCE_ID)) {
        map.addSource(COMPLETE_POINTS_SOURCE_ID, buildCompleteSourceSpec());
        map.addSource(COMPLETE_THEME_SOURCE_ID, buildCompleteSourceSpec());
        map.addLayer(buildDotsLayerSpec());
        map.addLayer(buildSymbolLayerSpec());
        for (const [key, { imageData }] of spriteMap) {
          map.addImage(key, imageData);
        }
      }

      expect(map._state.sources.size).toBe(2);
      expect(map._state.layers.size).toBe(2);
      expect(map._state.images.size).toBe(2);
    });
  });
});
