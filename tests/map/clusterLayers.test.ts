import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  CLUSTER_CIRCLE_LAYER_ID,
  CLUSTER_COUNT_LAYER_ID,
  COMPLETE_POINTS_SOURCE_ID,
  ensureClusterLayers,
  removeClusterLayers,
  getClusterExpansionTarget,
} from '@/components/map/ClusterLayers';
import { LOD_THUMBNAILS_MIN_ZOOM } from '@/components/map/utils/clusterEngine';

// ---------------------------------------------------------------------------
// Mock map factory
// ---------------------------------------------------------------------------

interface MockLayer {
  id: string;
  type: string;
  source: string;
  filter?: unknown[];
  paint?: Record<string, unknown>;
  layout?: Record<string, unknown>;
}

function createMockMap() {
  const layers = new Map<string, MockLayer>();

  return {
    layers,
    getLayer: vi.fn((id: string) => layers.get(id) ?? undefined),
    addLayer: vi.fn((spec: MockLayer) => {
      layers.set(spec.id, spec);
    }),
    removeLayer: vi.fn((id: string) => {
      layers.delete(id);
    }),
    getSource: vi.fn(() => ({})), // source always exists (Task 8 concern)
  } as unknown as maplibregl.Map & { layers: Map<string, MockLayer> };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ClusterLayers', () => {
  let map: ReturnType<typeof createMockMap>;

  beforeEach(() => {
    map = createMockMap();
  });

  // ---- ensureClusterLayers ----

  describe('ensureClusterLayers', () => {
    it('adds cluster circle layer with step-based sizing by point_count', () => {
      ensureClusterLayers(map);

      const circleLayer = map.layers.get(CLUSTER_CIRCLE_LAYER_ID);
      expect(circleLayer).toBeDefined();
      expect(circleLayer!.type).toBe('circle');
      expect(circleLayer!.source).toBe(COMPLETE_POINTS_SOURCE_ID);

      // Verify step expression for radius
      const radius = circleLayer!.paint!['circle-radius'] as unknown[];
      expect(radius[0]).toBe('step');
      expect(radius[1]).toEqual(['get', 'point_count']);
      // Steps: 15px default, 20px at 10, 25px at 30, 30px at 100
      expect(radius).toContain(15);
      expect(radius).toContain(20);
      expect(radius).toContain(25);
      expect(radius).toContain(30);
    });

    it('adds cluster circle layer with brand pink color', () => {
      ensureClusterLayers(map);

      const circleLayer = map.layers.get(CLUSTER_CIRCLE_LAYER_ID);
      expect(circleLayer).toBeDefined();
      expect(circleLayer!.paint!['circle-color']).toBe('#ec4899');
    });

    it('adds cluster count symbol layer displaying point_count_abbreviated', () => {
      ensureClusterLayers(map);

      const countLayer = map.layers.get(CLUSTER_COUNT_LAYER_ID);
      expect(countLayer).toBeDefined();
      expect(countLayer!.type).toBe('symbol');
      expect(countLayer!.source).toBe(COMPLETE_POINTS_SOURCE_ID);

      // Text field uses point_count_abbreviated
      const textField = countLayer!.layout!['text-field'] as unknown[];
      expect(textField).toEqual(['get', 'point_count_abbreviated']);

      // White bold text
      expect(countLayer!.paint!['text-color']).toBe('#ffffff');
    });

    it('filters cluster layers to only show clustered features', () => {
      ensureClusterLayers(map);

      const circleLayer = map.layers.get(CLUSTER_CIRCLE_LAYER_ID);
      expect(circleLayer!.filter).toEqual(['has', 'point_count']);
    });

    it('is idempotent — does not re-add layers if they already exist', () => {
      ensureClusterLayers(map);
      ensureClusterLayers(map);

      // addLayer should have been called exactly twice (once per layer, first call only)
      expect(map.addLayer).toHaveBeenCalledTimes(2);
    });
  });

  // ---- removeClusterLayers ----

  describe('removeClusterLayers', () => {
    it('removes both cluster layers when they exist', () => {
      ensureClusterLayers(map);
      expect(map.layers.size).toBe(2);

      removeClusterLayers(map);

      expect(map.layers.size).toBe(0);
      expect(map.removeLayer).toHaveBeenCalledWith(CLUSTER_COUNT_LAYER_ID);
      expect(map.removeLayer).toHaveBeenCalledWith(CLUSTER_CIRCLE_LAYER_ID);
    });

    it('is safe when layers do not exist (no throw)', () => {
      // Should not throw even when no layers are present
      expect(() => removeClusterLayers(map)).not.toThrow();
    });
  });

  // ---- getClusterExpansionTarget ----

  describe('getClusterExpansionTarget', () => {
    it('returns center and zoom for a cluster feature', () => {
      const mockClusterEngine = {
        getClusterExpansionZoom: vi.fn().mockReturnValue(8),
      };

      const clusterFeature = {
        type: 'Feature' as const,
        properties: {
          cluster: true,
          cluster_id: 42,
          point_count: 15,
        },
        geometry: {
          type: 'Point' as const,
          coordinates: [139.7, 35.7],
        },
      };

      const result = getClusterExpansionTarget(clusterFeature, mockClusterEngine);

      expect(result).toEqual({
        center: { lng: 139.7, lat: 35.7 },
        zoom: 8,
      });
      expect(mockClusterEngine.getClusterExpansionZoom).toHaveBeenCalledWith(42);
    });

    it('caps zoom to LOD_THUMBNAILS_MIN_ZOOM', () => {
      const mockClusterEngine = {
        getClusterExpansionZoom: vi.fn().mockReturnValue(18),
      };

      const clusterFeature = {
        type: 'Feature' as const,
        properties: {
          cluster: true,
          cluster_id: 99,
          point_count: 5,
        },
        geometry: {
          type: 'Point' as const,
          coordinates: [140.0, 36.0],
        },
      };

      const result = getClusterExpansionTarget(clusterFeature, mockClusterEngine);

      expect(result.zoom).toBeLessThanOrEqual(LOD_THUMBNAILS_MIN_ZOOM);
    });
  });

  // ---- Layer constants ----

  describe('layer IDs and source ID', () => {
    it('exports expected constant values', () => {
      expect(CLUSTER_CIRCLE_LAYER_ID).toBe('complete-clusters');
      expect(CLUSTER_COUNT_LAYER_ID).toBe('complete-cluster-count');
      expect(COMPLETE_POINTS_SOURCE_ID).toBe('complete-points');
    });
  });
});
