import { describe, it, expect } from 'vitest';
import { createGlobalFeatureCollection } from '@/components/map/utils/globalFeatureCollection';

describe('createGlobalFeatureCollection', () => {
  it('should return empty FeatureCollection for empty input', () => {
    const result = createGlobalFeatureCollection([]);

    expect(result).toEqual({
      type: 'FeatureCollection',
      features: [],
    });
  });

  it('should create features with priority, icon, bangumiId, and color properties', () => {
    const points = [
      { lat: 35.6762, lng: 139.6503, bangumiId: '123', color: '#ff0000', pointId: 'p1' },
      { lat: 34.6937, lng: 135.5023, bangumiId: '456', color: '#00ff00', pointId: 'p2' },
    ];

    const result = createGlobalFeatureCollection(points);

    expect(result.type).toBe('FeatureCollection');
    expect(result.features).toHaveLength(2);

    // Check first feature
    const feature1 = result.features[0];
    expect(feature1.type).toBe('Feature');
    expect(feature1.geometry.type).toBe('Point');
    expect(feature1.geometry.coordinates).toEqual([139.6503, 35.6762]); // lng, lat (swapped)
    expect(feature1.properties).toHaveProperty('priority');
    expect(typeof feature1.properties.priority).toBe('number');
    expect(feature1.properties.icon).toBe(''); // empty placeholder
    expect(feature1.properties.bangumiId).toBe('123');
    expect(feature1.properties.color).toBe('#ff0000');
    expect(feature1.properties.pointId).toBe('p1');

    // Check second feature
    const feature2 = result.features[1];
    expect(feature2.geometry.coordinates).toEqual([135.5023, 34.6937]); // lng, lat (swapped)
    expect(feature2.properties).toHaveProperty('priority');
    expect(typeof feature2.properties.priority).toBe('number');
    expect(feature2.properties.icon).toBe(''); // empty placeholder
    expect(feature2.properties.bangumiId).toBe('456');
    expect(feature2.properties.color).toBe('#00ff00');
    expect(feature2.properties.pointId).toBe('p2');
  });

  it('should calculate priority correctly for single point', () => {
    const points = [
      { lat: 35.6762, lng: 139.6503, bangumiId: '123', color: '#ff0000', pointId: 'p1' },
    ];

    const result = createGlobalFeatureCollection(points);

    expect(result.features[0].properties.priority).toBe(Infinity);
  });

  it('should calculate priority based on distance for multiple points', () => {
    const points = [
      { lat: 35.6762, lng: 139.6503, bangumiId: '123', color: '#ff0000', pointId: 'p1' },
      { lat: 35.6763, lng: 139.6504, bangumiId: '456', color: '#00ff00', pointId: 'p2' }, // very close
      { lat: 40.7128, lng: -74.0060, bangumiId: '789', color: '#0000ff', pointId: 'p3' }, // far away
    ];

    const result = createGlobalFeatureCollection(points);

    // Close points should have low priority (small distance)
    const priority1 = result.features[0].properties.priority;
    const priority2 = result.features[1].properties.priority;
    const priority3 = result.features[2].properties.priority;

    // Points 1 and 2 are close, so their priorities should be small
    expect(priority1).toBeLessThan(1000);
    expect(priority2).toBeLessThan(1000);

    // Point 3 is far from others, so priority should be large
    expect(priority3).toBeGreaterThan(1000000);
  });

  it('should preserve all input properties in output features', () => {
    const points = [
      { lat: 35.6762, lng: 139.6503, bangumiId: '123', color: '#ff0000', pointId: 'p1' },
    ];

    const result = createGlobalFeatureCollection(points);
    const props = result.features[0].properties;

    expect(props).toHaveProperty('bangumiId', '123');
    expect(props).toHaveProperty('color', '#ff0000');
    expect(props).toHaveProperty('pointId', 'p1');
    expect(props).toHaveProperty('priority');
    expect(props).toHaveProperty('icon', '');
  });

  it('should handle identical coordinates (priority = 0)', () => {
    const points = [
      { lat: 35.6762, lng: 139.6503, bangumiId: '123', color: '#ff0000', pointId: 'p1' },
      { lat: 35.6762, lng: 139.6503, bangumiId: '456', color: '#00ff00', pointId: 'p2' }, // same coords
    ];

    const result = createGlobalFeatureCollection(points);

    // Identical coordinates should result in priority = 0
    expect(result.features[0].properties.priority).toBe(0);
    expect(result.features[1].properties.priority).toBe(0);
  });
});
