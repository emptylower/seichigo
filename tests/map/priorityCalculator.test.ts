import { describe, it, expect } from "vitest";
import {
  calculatePriority,
  haversineDistance,
} from "@/components/map/utils/priorityCalculator";

describe("haversineDistance", () => {
  it("returns 0 for identical points", () => {
    expect(haversineDistance(35.6762, 139.6503, 35.6762, 139.6503)).toBe(0);
  });

  it("calculates distance between Tokyo and Osaka (~400km)", () => {
    const d = haversineDistance(35.6762, 139.6503, 34.6937, 135.5023);
    expect(d).toBeGreaterThan(390_000);
    expect(d).toBeLessThan(405_000);
  });

  it("calculates short distance accurately (~1km)", () => {
    const d = haversineDistance(35.6762, 139.6503, 35.6852, 139.6503);
    expect(d).toBeGreaterThan(900);
    expect(d).toBeLessThan(1100);
  });

  it("handles antipodal points (~20000km)", () => {
    const d = haversineDistance(0, 0, 0, 180);
    expect(d).toBeGreaterThan(20_000_000);
    expect(d).toBeLessThan(20_100_000);
  });
});

describe("calculatePriority", () => {
  it("returns empty array for empty input", () => {
    expect(calculatePriority([])).toEqual([]);
  });

  it("returns Infinity for a single point", () => {
    const result = calculatePriority([{ lng: 139.6503, lat: 35.6762 }]);
    expect(result).toEqual([Infinity]);
  });

  it("returns symmetric distances for two points", () => {
    const points = [
      { lng: 139.6503, lat: 35.6762 },
      { lng: 135.5023, lat: 34.6937 },
    ];
    const result = calculatePriority(points);
    expect(result[0]).toBe(result[1]);
    expect(result[0]).toBeGreaterThan(390_000);
    expect(result[0]).toBeLessThan(405_000);
  });

  it("returns 0 for identical coordinates", () => {
    const points = [
      { lng: 139.6503, lat: 35.6762 },
      { lng: 139.6503, lat: 35.6762 },
    ];
    const result = calculatePriority(points);
    expect(result[0]).toBe(0);
    expect(result[1]).toBe(0);
  });

  it("assigns min distance to nearest neighbor for multiple points", () => {
    const points = [
      { lng: 139.6503, lat: 35.6762 },
      { lng: 139.6510, lat: 35.6770 },
      { lng: 135.5023, lat: 34.6937 },
    ];
    const result = calculatePriority(points);
    expect(result[0]).toBeLessThan(200);
    expect(result[1]).toBeLessThan(200);
    expect(result[2]).toBeGreaterThan(390_000);
  });

  it("uses ceil for priority values", () => {
    const points = [
      { lng: 0, lat: 0 },
      { lng: 0.001, lat: 0 },
    ];
    const result = calculatePriority(points);
    expect(Number.isInteger(result[0])).toBe(true);
    expect(Number.isInteger(result[1])).toBe(true);
  });

  it("does not mutate input array", () => {
    const points = [
      { lng: 139.6503, lat: 35.6762 },
      { lng: 135.5023, lat: 34.6937 },
    ];
    const original = JSON.parse(JSON.stringify(points));
    calculatePriority(points);
    expect(points).toEqual(original);
  });

  it("handles many points without error", () => {
    const points = Array.from({ length: 100 }, (_, i) => ({
      lng: 139 + i * 0.01,
      lat: 35 + i * 0.01,
    }));
    const result = calculatePriority(points);
    expect(result).toHaveLength(100);
    result.forEach((p) => {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(typeof p).toBe("number");
    });
  });
});
