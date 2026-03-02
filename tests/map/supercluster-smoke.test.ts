import { describe, it, expect } from 'vitest';
import Supercluster from 'supercluster';

describe('Supercluster smoke test', () => {
  it('should create index, load points, get clusters, and verify output', () => {
    // Create 10 test points (GeoJSON features)
    const points: Array<Supercluster.PointFeature<{ id: number }>> = [
      { type: 'Feature', properties: { id: 1 }, geometry: { type: 'Point', coordinates: [139.6917, 35.6895] } }, // Tokyo
      { type: 'Feature', properties: { id: 2 }, geometry: { type: 'Point', coordinates: [139.7000, 35.6900] } }, // Near Tokyo
      { type: 'Feature', properties: { id: 3 }, geometry: { type: 'Point', coordinates: [135.5023, 34.6937] } }, // Osaka
      { type: 'Feature', properties: { id: 4 }, geometry: { type: 'Point', coordinates: [135.5100, 34.7000] } }, // Near Osaka
      { type: 'Feature', properties: { id: 5 }, geometry: { type: 'Point', coordinates: [130.4017, 33.5904] } }, // Fukuoka
      { type: 'Feature', properties: { id: 6 }, geometry: { type: 'Point', coordinates: [130.4100, 33.6000] } }, // Near Fukuoka
      { type: 'Feature', properties: { id: 7 }, geometry: { type: 'Point', coordinates: [141.3545, 43.0642] } }, // Sapporo
      { type: 'Feature', properties: { id: 8 }, geometry: { type: 'Point', coordinates: [141.3600, 43.0700] } }, // Near Sapporo
      { type: 'Feature', properties: { id: 9 }, geometry: { type: 'Point', coordinates: [127.6809, 26.2124] } }, // Okinawa
      { type: 'Feature', properties: { id: 10 }, geometry: { type: 'Point', coordinates: [127.6900, 26.2200] } }, // Near Okinawa
    ];

    // Create Supercluster index
    const index = new Supercluster({
      radius: 40,
      maxZoom: 16,
    });

    // Load points into index
    index.load(points);

    // Get clusters at zoom level 5 (should show clustering)
    const clusters = index.getClusters([-180, -85, 180, 85], 5);

    // Verify cluster count output
    expect(clusters).toBeDefined();
    expect(Array.isArray(clusters)).toBe(true);
    expect(clusters.length).toBeGreaterThan(0);
    expect(clusters.length).toBeLessThanOrEqual(10); // Should cluster some points

    // Verify cluster structure
    const firstCluster = clusters[0];
    expect(firstCluster).toHaveProperty('type', 'Feature');
    expect(firstCluster).toHaveProperty('geometry');
    expect(firstCluster.geometry).toHaveProperty('type', 'Point');
    expect(firstCluster.geometry).toHaveProperty('coordinates');
    expect(firstCluster).toHaveProperty('properties');

    // At zoom 5, we should have clustering (fewer than 10 results)
    // because points are grouped by proximity
    expect(clusters.length).toBeLessThan(10);

    // Get clusters at zoom level 16 (should show individual points)
    const detailedClusters = index.getClusters([-180, -85, 180, 85], 16);
    expect(detailedClusters.length).toBe(10); // All points visible at max zoom
  });
});
