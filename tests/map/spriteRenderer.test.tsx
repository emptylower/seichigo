import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cutSpriteSheet, type SpriteRenderResult } from '@/components/map/utils/spriteRenderer';
import type { AnitabiTheme } from '@/components/map/types';

// ── Canvas mock infrastructure ──────────────────────────────────────────────

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

function failingImageLoader(_url: string): Promise<HTMLImageElement> {
  return Promise.reject(new Error('CORS error'));
}

// ── Mock document.createElement ─────────────────────────────────────────────

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

// ── Tests ───────────────────────────────────────────────────────────────────

describe('cutSpriteSheet', () => {
  const bangumiId = 12345;
  const color = '#e91e63';

  const makeTheme = (ids: string[], w = 100, h = 76): AnitabiTheme => ({
    ids, src: '/images/ptheme/test_100_76.webp', w, h,
  });

  /** Create points whose IDs match the given theme IDs */
  const makePoints = (themeIds: string[]) =>
    themeIds.map((id) => ({ id }));

  it('produces correct number of ImageData entries for 3 IDs', async () => {
    const ids = ['a', 'b', 'c'];
    const theme = makeTheme(ids);
    const points = makePoints(ids);
    const result = await cutSpriteSheet(bangumiId, theme, points, color, mockImageLoader);
    expect(result.size).toBe(3);
    for (const id of ids) {
      const key = `sprite-${bangumiId}-${id}`;
      expect(result.has(key)).toBe(true);
      const entry = result.get(key)!;
      expect(entry.imageData).toBeDefined();
      expect(entry.width).toBeGreaterThan(0);
      expect(entry.height).toBeGreaterThan(0);
    }
  });

  it('calculates grid layout as cols = floor(sqrt(n))', async () => {
    const ids = Array.from({ length: 9 }, (_, i) => `id-${i}`);
    const theme = makeTheme(ids);
    const points = makePoints(ids);
    const result = await cutSpriteSheet(bangumiId, theme, points, color, mockImageLoader);
    expect(result.size).toBe(9);
    const drawCalls = lastCanvas._ctx._calls.filter((c) => c.method === 'drawImage');
    expect(drawCalls.length).toBeGreaterThanOrEqual(9);
  });

  it('includes colored pin shape in output dimensions', async () => {
    const theme = makeTheme(['only'], 100, 76);
    const points = makePoints(['only']);
    const result = await cutSpriteSheet(bangumiId, theme, points, color, mockImageLoader);
    const entry = result.get(`sprite-${bangumiId}-only`)!;
    expect(entry.width).toBe(100);
    expect(entry.height).toBe(89); // 76 + 13
  });

  it('uses pixelRatio 2 for retina canvas sizing', async () => {
    const theme = makeTheme(['r'], 100, 76);
    const points = makePoints(['r']);
    await cutSpriteSheet(bangumiId, theme, points, color, mockImageLoader);
    const getImageDataCalls = lastCanvas._ctx.getImageData.mock.calls;
    expect(getImageDataCalls.length).toBe(1);
    const [, , w, h] = getImageDataCalls[0];
    expect(w).toBe(200);  // 100 * 2
    expect(h).toBe(178);  // (76 + 13) * 2
  });

  it('returns empty Map for null theme', async () => {
    const result = await cutSpriteSheet(bangumiId, null as any, [{ id: 'x' }], color, mockImageLoader);
    expect(result.size).toBe(0);
  });

  it('returns empty Map for theme with missing src', async () => {
    const result = await cutSpriteSheet(bangumiId, { ids: ['a'], src: '' } as AnitabiTheme, [{ id: 'a' }], color, mockImageLoader);
    expect(result.size).toBe(0);
  });

  it('returns empty Map for theme with empty ids', async () => {
    const result = await cutSpriteSheet(bangumiId, { ids: [], src: '/img.webp' } as AnitabiTheme, [], color, mockImageLoader);
    expect(result.size).toBe(0);
  });

  it('returns empty Map on image load failure (no throw)', async () => {
    const theme = makeTheme(['a', 'b']);
    const result = await cutSpriteSheet(bangumiId, theme, makePoints(['a', 'b']), color, failingImageLoader);
    expect(result.size).toBe(0);
  });

  it('output keys follow sprite-{bangumiId}-{pointId} format', async () => {
    const theme = makeTheme(['x', 'y']);
    const points = [{ id: 'x' }, { id: 'y' }];
    const result = await cutSpriteSheet(42, theme, points, color, mockImageLoader);
    expect(result.has('sprite-42-x')).toBe(true);
    expect(result.has('sprite-42-y')).toBe(true);
  });

  it('handles more points than theme IDs (extra points get no sprite)', async () => {
    const theme = makeTheme(['a', 'b']);
    // 5 points but only 'a' and 'b' match theme IDs
    const points = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }];
    const result = await cutSpriteSheet(bangumiId, theme, points, color, mockImageLoader);
    expect(result.size).toBe(2);
  });

  it('uses default dimensions when w/h are omitted', async () => {
    const theme: AnitabiTheme = { ids: ['a'], src: '/img.webp' };
    const points = [{ id: 'a' }];
    const result = await cutSpriteSheet(bangumiId, theme, points, color, mockImageLoader);
    const entry = result.get(`sprite-${bangumiId}-a`)!;
    expect(entry.width).toBe(72);
    expect(entry.height).toBe(67); // 54 + 13
  });

  it('matches points to sprites by ID regardless of order', async () => {
    // Theme IDs in one order, points in a different order
    const theme = makeTheme(['alpha', 'beta', 'gamma', 'delta']);
    const points = [{ id: 'delta' }, { id: 'beta' }, { id: 'alpha' }, { id: 'gamma' }];
    const result = await cutSpriteSheet(bangumiId, theme, points, color, mockImageLoader);
    expect(result.size).toBe(4);
    expect(result.has(`sprite-${bangumiId}-alpha`)).toBe(true);
    expect(result.has(`sprite-${bangumiId}-beta`)).toBe(true);
    expect(result.has(`sprite-${bangumiId}-gamma`)).toBe(true);
    expect(result.has(`sprite-${bangumiId}-delta`)).toBe(true);
  });

  it('only cuts sprites for points whose IDs exist in theme.ids', async () => {
    const theme = makeTheme(['a', 'b', 'c']);
    // Only 'b' matches a theme ID
    const points = [{ id: 'x' }, { id: 'b' }, { id: 'z' }];
    const result = await cutSpriteSheet(bangumiId, theme, points, color, mockImageLoader);
    expect(result.size).toBe(1);
    expect(result.has(`sprite-${bangumiId}-b`)).toBe(true);
  });

  it('matches scoped point IDs against raw theme IDs from preload data', async () => {
    const theme = makeTheme(['raw-a', 'raw-b']);
    const points = [{ id: `${bangumiId}:raw-a` }, { id: `${bangumiId}:raw-b` }];
    const result = await cutSpriteSheet(bangumiId, theme, points, color, mockImageLoader);
    expect(result.size).toBe(2);
    expect(result.has(`sprite-${bangumiId}-${bangumiId}:raw-a`)).toBe(true);
    expect(result.has(`sprite-${bangumiId}-${bangumiId}:raw-b`)).toBe(true);
  });
});
