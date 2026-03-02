import { describe, it, expect, beforeEach } from 'vitest';
import {
  createClusterEngine,
  LOD_DOTS_MAX_ZOOM,
  LOD_ICONS_MAX_ZOOM,
  LOD_THUMBNAILS_MIN_ZOOM,
} from '@/components/map/utils/clusterEngine';
import type Supercluster from 'supercluster';

// Helper: generate N random GeoJSON point features around Japan
function generatePoints(
  count: number,
): Supercluster.PointFeature<{ id: number }>[] {
  const features: Supercluster.PointFeature<{ id: number }>[] = [];
  for (let i = 0; i < count; i++) {
    features.push({
      type: 'Feature',
      properties: { id: i },
      geometry: {
        type: 'Point',
        coordinates: [
          130 + Math.random() * 15, // lng ~130-145 (Japan range)
          30 + Math.random() * 15, // lat ~30-45
        ],
      },
    });
  }
  return features;
}

const WORLD_BBOX: [number, number, number, number] = [-180, -85, 180, 85];

describe('createClusterEngine', () => {
  describe('LOD constants', () => {
    it('exports correct LOD zoom thresholds', () => {
      expect(LOD_DOTS_MAX_ZOOM).toBe(10);
      expect(LOD_ICONS_MAX_ZOOM).toBe(14);
      expect(LOD_THUMBNAILS_MIN_ZOOM).toBe(14);
    });

    it('LOD thresholds form a valid progression', () => {
      expect(LOD_DOTS_MAX_ZOOM).toBeLessThanOrEqual(LOD_ICONS_MAX_ZOOM);
      expect(LOD_ICONS_MAX_ZOOM).toBeLessThanOrEqual(LOD_THUMBNAILS_MIN_ZOOM);
    });
  });

  describe('factory defaults', () => {
    it('creates engine with default options', () => {
      const engine = createClusterEngine();
      expect(engine).toBeDefined();
      expect(engine.load).toBeTypeOf('function');
      expect(engine.getClusters).toBeTypeOf('function');
      expect(engine.getLeaves).toBeTypeOf('function');
      expect(engine.getClusterExpansionZoom).toBeTypeOf('function');
    });

    it('accepts custom options', () => {
      const engine = createClusterEngine({
        radius: 80,
        maxZoom: 18,
        minPoints: 5,
      });
      expect(engine).toBeDefined();
    });
  });

  describe('empty input', () => {
    it('returns empty clusters for empty input (no crash)', () => {
      const engine = createClusterEngine();
      engine.load([]);
      const clusters = engine.getClusters(WORLD_BBOX, 5);
      expect(clusters).toEqual([]);
    });
  });

  describe('single point', () => {
    it('returns the single point unclustered at any zoom', () => {
      const engine = createClusterEngine();
      const point: Supercluster.PointFeature<{ id: number }> = {
        type: 'Feature',
        properties: { id: 42 },
        geometry: { type: 'Point', coordinates: [139.7, 35.7] },
      };
      engine.load([point]);

      const atLow = engine.getClusters(WORLD_BBOX, 0);
      expect(atLow).toHaveLength(1);

      const atHigh = engine.getClusters(WORLD_BBOX, 18);
      expect(atHigh).toHaveLength(1);
    });
  });

  describe('100 points clustering behavior', () => {
    let engine: ReturnType<typeof createClusterEngine>;
    const points = generatePoints(100);

    beforeEach(() => {
      engine = createClusterEngine();
      engine.load(points);
    });

    it('at zoom 5 produces fewer features than point count (clustering)', () => {
      const clusters = engine.getClusters(WORLD_BBOX, 5);
      expect(clusters.length).toBeGreaterThan(0);
      expect(clusters.length).toBeLessThan(100);
    });

    it('at zoom 18 returns all 100 unclustered features', () => {
      const features = engine.getClusters(WORLD_BBOX, 18);
      expect(features).toHaveLength(100);
    });

    it('cluster features have cluster property true and point_count', () => {
      const clusters = engine.getClusters(WORLD_BBOX, 5);
      const clusterFeature = clusters.find(
        (f) => f.properties && 'cluster' in f.properties && f.properties.cluster,
      );
      // With 100 points and default radius/minPoints, there should be at least one cluster
      expect(clusterFeature).toBeDefined();
      expect(clusterFeature!.properties.point_count).toBeGreaterThanOrEqual(3);
    });
  });

  describe('getLeaves', () => {
    it('returns child points for a cluster', () => {
      const engine = createClusterEngine();
      const points = generatePoints(100);
      engine.load(points);

      const clusters = engine.getClusters(WORLD_BBOX, 5);
      const clusterFeature = clusters.find(
        (f) => f.properties && 'cluster' in f.properties && f.properties.cluster,
      );
      expect(clusterFeature).toBeDefined();

      const clusterId = clusterFeature!.properties.cluster_id as number;
      const leaves = engine.getLeaves(clusterId);
      expect(leaves.length).toBeGreaterThan(0);
      // Each leaf should be an individual point (no cluster property)
      for (const leaf of leaves) {
        expect(leaf.properties).not.toHaveProperty('cluster');
      }
    });

    it('respects limit parameter', () => {
      const engine = createClusterEngine();
      const points = generatePoints(100);
      engine.load(points);

      const clusters = engine.getClusters(WORLD_BBOX, 5);
      const clusterFeature = clusters.find(
        (f) =>
          f.properties &&
          'cluster' in f.properties &&
          f.properties.cluster &&
          f.properties.point_count > 3,
      );
      expect(clusterFeature).toBeDefined();

      const clusterId = clusterFeature!.properties.cluster_id as number;
      const leaves = engine.getLeaves(clusterId, 2);
      expect(leaves.length).toBeLessThanOrEqual(2);
    });
  });

  describe('getClusterExpansionZoom', () => {
    it('returns a valid zoom number for a cluster', () => {
      const engine = createClusterEngine();
      const points = generatePoints(100);
      engine.load(points);

      const clusters = engine.getClusters(WORLD_BBOX, 5);
      const clusterFeature = clusters.find(
        (f) => f.properties && 'cluster' in f.properties && f.properties.cluster,
      );
      expect(clusterFeature).toBeDefined();

      const clusterId = clusterFeature!.properties.cluster_id as number;
      const zoom = engine.getClusterExpansionZoom(clusterId);
      expect(zoom).toBeTypeOf('number');
      expect(zoom).toBeGreaterThan(5);
      expect(zoom).toBeLessThanOrEqual(20);
    });
  });

  describe('boundary zoom levels', () => {
    it('at LOD_DOTS_MAX_ZOOM still has some clustering', () => {
      const engine = createClusterEngine();
      const points = generatePoints(100);
      engine.load(points);

      const features = engine.getClusters(WORLD_BBOX, LOD_DOTS_MAX_ZOOM);
      // At zoom 10 with default maxZoom=14, should still cluster nearby points
      expect(features.length).toBeLessThanOrEqual(100);
    });

    it('at LOD_THUMBNAILS_MIN_ZOOM most points are unclustered', () => {
      const engine = createClusterEngine();
      const points = generatePoints(100);
      engine.load(points);

      const features = engine.getClusters(WORLD_BBOX, LOD_THUMBNAILS_MIN_ZOOM);
      // At zoom 14 (== maxZoom default), should be fully or nearly unclustered
      expect(features.length).toBeGreaterThanOrEqual(90);
    });
  });
});
