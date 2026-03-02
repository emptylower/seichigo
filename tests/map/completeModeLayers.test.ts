import { describe, it, expect } from 'vitest';
import {
  COMPLETE_POINTS_SOURCE_ID,
  COMPLETE_DOTS_LAYER_ID,
  COMPLETE_ICONS_LAYER_ID,
  buildCompleteSourceSpec,
  buildDotsLayerSpec,
  buildSymbolLayerSpec,
  ZOOM_PRIORITY_FILTER,
} from '@/components/map/CompleteModeLayers';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
describe('layer/source IDs', () => {
  it('exports stable source ID', () => {
    expect(COMPLETE_POINTS_SOURCE_ID).toBe('complete-points');
  });

  it('exports stable dots layer ID', () => {
    expect(COMPLETE_DOTS_LAYER_ID).toBe('complete-dots');
  });

  it('exports stable symbol layer ID', () => {
    expect(COMPLETE_ICONS_LAYER_ID).toBe('complete-icons');
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
    expect(spec.source).toBe('complete-points');
  });

  it('uses point color from feature property', () => {
    const spec = buildDotsLayerSpec();
    expect(spec.paint!['circle-color']).toEqual(['get', 'color']);
  });

  it('applies the same priority filter as the symbol layer', () => {
    const spec = buildDotsLayerSpec();
    expect(spec.filter).toEqual(ZOOM_PRIORITY_FILTER);
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
    expect(spec.source).toBe('complete-points');
  });

  it('uses icon-image from feature property', () => {
    const spec = buildSymbolLayerSpec();
    expect(spec.layout!['icon-image']).toEqual(['get', 'icon']);
  });

  it('has icon-allow-overlap: true', () => {
    const spec = buildSymbolLayerSpec();
    expect(spec.layout!['icon-allow-overlap']).toBe(true);
  });

  it('has icon-ignore-placement: true', () => {
    const spec = buildSymbolLayerSpec();
    expect(spec.layout!['icon-ignore-placement']).toBe(true);
  });

  it('has icon-anchor: bottom', () => {
    const spec = buildSymbolLayerSpec();
    expect(spec.layout!['icon-anchor']).toBe('bottom');
  });

  it('applies the 20-tier zoom-step priority filter', () => {
    const spec = buildSymbolLayerSpec();
    expect(spec.filter).toEqual(ZOOM_PRIORITY_FILTER);
  });
});

// ---------------------------------------------------------------------------
// 20-tier zoom-step filter
// ---------------------------------------------------------------------------
describe('ZOOM_PRIORITY_FILTER', () => {
  it('is a step expression on zoom', () => {
    expect(ZOOM_PRIORITY_FILTER[0]).toBe('step');
    expect(ZOOM_PRIORITY_FILTER[1]).toEqual(['zoom']);
  });

  it('has correct length (default + 17 zoom stops + final true)', () => {
    // ["step", ["zoom"], defaultExpr, z3, expr3, ..., z19, true]
    // = 3 + 17*2 = 37
    expect(ZOOM_PRIORITY_FILTER.length).toBe(37);
  });

  it('default (zoom < 3) filters priority > 48000', () => {
    expect(ZOOM_PRIORITY_FILTER[2]).toEqual(['>', ['get', 'priority'], 48000]);
  });

  it('at zoom 19 shows all points (true)', () => {
    expect(ZOOM_PRIORITY_FILTER[ZOOM_PRIORITY_FILTER.length - 1]).toBe(true);
  });

  it('thresholds decrease as zoom increases', () => {
    const thresholds: number[] = [];
    for (let i = 4; i < ZOOM_PRIORITY_FILTER.length - 2; i += 2) {
      const expr = ZOOM_PRIORITY_FILTER[i] as unknown as [string, [string, string], number];
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
