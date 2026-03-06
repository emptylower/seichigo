import { describe, it, expect } from 'vitest';
import {
  COMPLETE_POINTS_SOURCE_ID,
  COMPLETE_THEME_SOURCE_ID,
  COMPLETE_DOTS_LAYER_ID,
  COMPLETE_ICONS_LAYER_ID,
  COMPLETE_POINT_IMAGES_SOURCE_ID,
  COMPLETE_POINT_IMAGES_LAYER_ID,
  buildCompleteSourceSpec,
  buildDotsLayerSpec,
  buildSymbolLayerSpec,
  buildThemeSymbolLayerSpec,
  buildPointImagesLayerSpec,
  ZOOM_PRIORITY_FILTER,
} from '@/components/map/CompleteModeLayers';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
describe('layer/source IDs', () => {
  it('exports stable source ID', () => {
    expect(COMPLETE_POINTS_SOURCE_ID).toBe('complete-points');
  });

  it('exports stable theme source ID', () => {
    expect(COMPLETE_THEME_SOURCE_ID).toBe('complete-theme-source');
  });

  it('exports stable dots layer ID', () => {
    expect(COMPLETE_DOTS_LAYER_ID).toBe('complete-dots');
  });

  it('exports stable symbol layer ID', () => {
    expect(COMPLETE_ICONS_LAYER_ID).toBe('complete-icons');
  });

  it('exports stable point-images source/layer IDs', () => {
    expect(COMPLETE_POINT_IMAGES_SOURCE_ID).toBe('complete-point-images-source');
    expect(COMPLETE_POINT_IMAGES_LAYER_ID).toBe('complete-point-images');
  });
});

// ---------------------------------------------------------------------------
// Source spec
// ---------------------------------------------------------------------------
describe('buildCompleteSourceSpec', () => {
  it('returns a GeoJSON source (not cluster/supercluster)', () => {
    const spec = buildCompleteSourceSpec();
    expect(spec.type).toBe('geojson');
    expect(spec.data).toEqual({ type: 'FeatureCollection', features: [] });
    expect(spec).not.toHaveProperty('cluster');
    expect(spec).not.toHaveProperty('clusterRadius');
    expect(spec).not.toHaveProperty('clusterMaxZoom');
  });
});

// ---------------------------------------------------------------------------
// Dots layer
// ---------------------------------------------------------------------------
describe('buildDotsLayerSpec', () => {
  it('creates a circle layer for all points', () => {
    const spec = buildDotsLayerSpec();
    expect(spec.id).toBe('complete-dots');
    expect(spec.type).toBe('circle');
    expect((spec as any).source).toBe('complete-points');
  });

  it('uses point color from feature property', () => {
    const spec = buildDotsLayerSpec();
    expect((spec as any).paint['circle-color']).toEqual(['get', 'color']);
  });

  it('applies the same priority filter as the symbol layer', () => {
    const spec = buildDotsLayerSpec();
    expect((spec as any).filter).toEqual(ZOOM_PRIORITY_FILTER);
  });
});

// ---------------------------------------------------------------------------
// Symbol layer
// ---------------------------------------------------------------------------
describe('buildSymbolLayerSpec', () => {
  it('creates a symbol layer', () => {
    const spec = buildSymbolLayerSpec();
    expect(spec.id).toBe('complete-icons');
    expect(spec.type).toBe('symbol');
    expect((spec as any).source).toBe('complete-theme-source');
  });

  it('uses icon-image from feature property', () => {
    const spec = buildSymbolLayerSpec();
    expect((spec as any).layout['icon-image']).toEqual(['get', 'icon']);
  });

  it('has icon-allow-overlap: true', () => {
    const spec = buildSymbolLayerSpec();
    expect((spec as any).layout['icon-allow-overlap']).toBe(true);
  });

  it('has icon-ignore-placement: true', () => {
    const spec = buildSymbolLayerSpec();
    expect((spec as any).layout['icon-ignore-placement']).toBe(true);
  });

  it('has icon-anchor: bottom', () => {
    const spec = buildSymbolLayerSpec();
    expect((spec as any).layout['icon-anchor']).toBe('bottom');
  });

  it('applies the 20-tier zoom-step priority filter', () => {
    const spec = buildSymbolLayerSpec();
    expect((spec as any).filter).toEqual(ZOOM_PRIORITY_FILTER);
  });
});

describe('buildThemeSymbolLayerSpec', () => {
  it('applies min/max zoom window for detail-mode theme icons', () => {
    const spec = buildThemeSymbolLayerSpec(15.8, 17.9);
    expect((spec as any).minzoom).toBe(15.8);
    expect((spec as any).maxzoom).toBe(17.9);
  });

  it('requires non-empty icon property', () => {
    const spec = buildThemeSymbolLayerSpec();
    expect((spec as any).filter).toEqual(['all', ZOOM_PRIORITY_FILTER, ['!=', ['get', 'icon'], '']]);
    expect((spec as any).source).toBe('complete-theme-source');
  });
});

describe('buildPointImagesLayerSpec', () => {
  it('creates a symbol layer on point-images source', () => {
    const spec = buildPointImagesLayerSpec(17.9);
    expect(spec.id).toBe('complete-point-images');
    expect(spec.type).toBe('symbol');
    expect((spec as any).source).toBe('complete-point-images-source');
  });

  it('reads icon from image property and sets minzoom', () => {
    const spec = buildPointImagesLayerSpec(17.7);
    expect((spec as any).layout['icon-image']).toEqual(['get', 'image']);
    expect((spec as any).minzoom).toBe(17.7);
  });
});

// ---------------------------------------------------------------------------
// 20-tier zoom-step filter
// ---------------------------------------------------------------------------
describe('ZOOM_PRIORITY_FILTER', () => {
  it('is a step expression on zoom', () => {
    expect((ZOOM_PRIORITY_FILTER as any)[0]).toBe('step');
    expect((ZOOM_PRIORITY_FILTER as any)[1]).toEqual(['zoom']);
  });

  it('has correct length (default + 17 zoom stops + final true)', () => {
    // ["step", ["zoom"], defaultExpr, z3, expr3, ..., z19, true]
    // = 3 + 17*2 = 37
    expect((ZOOM_PRIORITY_FILTER as any).length).toBe(37);
  });

  it('default (zoom < 3) filters priority > 48000', () => {
    expect((ZOOM_PRIORITY_FILTER as any)[2]).toEqual(['>', ['get', 'priority'], 48000]);
  });

  it('at zoom 19 shows all points (true)', () => {
    expect((ZOOM_PRIORITY_FILTER as any)[(ZOOM_PRIORITY_FILTER as any).length - 1]).toBe(true);
  });

  it('thresholds decrease as zoom increases', () => {
    const thresholds: number[] = [];
    for (let i = 4; i < (ZOOM_PRIORITY_FILTER as any).length - 2; i += 2) {
      const expr = (ZOOM_PRIORITY_FILTER as any)[i] as unknown as [string, [string, string], number];
      thresholds.push(expr[2]);
    }
    for (let i = 1; i < thresholds.length; i++) {
      expect(thresholds[i]).toBeLessThan(thresholds[i - 1]);
    }
  });
});

// ---------------------------------------------------------------------------
// Map interaction functions
// ---------------------------------------------------------------------------
describe('ensureCompleteModeSources', () => {
  it('is exported as a function', async () => {
    const mod = await import('@/components/map/CompleteModeLayers');
    expect(typeof mod.ensureCompleteModeSources).toBe('function');
  });
});

describe('ensureCompleteModeSymbolLayer', () => {
  it('is exported as a function', async () => {
    const mod = await import('@/components/map/CompleteModeLayers');
    expect(typeof mod.ensureCompleteModeSymbolLayer).toBe('function');
  });
});

describe('updateCompleteModeSources', () => {
  it('is exported as a function', async () => {
    const mod = await import('@/components/map/CompleteModeLayers');
    expect(typeof mod.updateCompleteModeSources).toBe('function');
  });
});

describe('updateCompleteModeThemeSource', () => {
  it('is exported as a function', async () => {
    const mod = await import('@/components/map/CompleteModeLayers');
    expect(typeof mod.updateCompleteModeThemeSource).toBe('function');
  });
});

describe('removeCompleteModeLayers', () => {
  it('is exported as a function', async () => {
    const mod = await import('@/components/map/CompleteModeLayers');
    expect(typeof mod.removeCompleteModeLayers).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// Label layer functions (must be preserved)
// ---------------------------------------------------------------------------
describe('label layer functions preserved', () => {
  it('exports ensureLabelLayer', async () => {
    const mod = await import('@/components/map/CompleteModeLayers');
    expect(typeof mod.ensureLabelLayer).toBe('function');
  });

  it('exports buildLabelFeatureCollection', async () => {
    const mod = await import('@/components/map/CompleteModeLayers');
    expect(typeof mod.buildLabelFeatureCollection).toBe('function');
  });

  it('exports updateLabelSource', async () => {
    const mod = await import('@/components/map/CompleteModeLayers');
    expect(typeof mod.updateLabelSource).toBe('function');
  });

  it('exports removeLabelLayer', async () => {
    const mod = await import('@/components/map/CompleteModeLayers');
    expect(typeof mod.removeLabelLayer).toBe('function');
  });
});
