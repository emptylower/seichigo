/**
 * Canvas-based sprite sheet cutter for Anitabi-style map markers.
 *
 * Cuts individual sprites from a theme sprite sheet and composites
 * a colored pin tail below each thumbnail. Pure data function —
 * does NOT interact with MapLibre or add images to the map.
 *
 * Grid layout mirrors Anitabi:
 *   cols = floor(sqrt(ids.length))
 *   sprite[i] at x = (i % cols) * w, y = floor(i / cols) * h
 *
 * theme.ids defines the grid order: theme.ids[0] is at grid position 0,
 * theme.ids[1] at position 1, etc. Points are matched by ID to their
 * grid position (point IDs and theme IDs may be in different order).
 *
 * Output includes a 13px pin tail below each thumbnail.
 * Uses pixelRatio=2 for retina displays.
 */

import { DEFAULT_THEME_WIDTH, DEFAULT_THEME_HEIGHT, isValidTheme } from '@/components/map/types';
import type { AnitabiTheme } from '@/components/map/types';

/** Pin tail height in logical pixels */
const PIN_TAIL_HEIGHT = 13;

/** Retina scaling factor */
const PIXEL_RATIO = 2;

/** SVG path for the pin tail shape (from Anitabi) */
const PIN_PATH = 'M0,0c2,0,2,0,8,8.2c2,2.8,2.5,2.8,3,2.8s1,0,3-2.8C20,0,20,0,22,0H0z';

export interface SpriteRenderResult {
  imageData: ImageData;
  width: number;
  height: number;
}

/** Callback type for loading sprite sheet images */
export type ImageLoader = (url: string) => Promise<HTMLImageElement>;

/**
 * Cut a sprite sheet into individual marker images with colored pin tails.
 *
 * @param bangumiId - Bangumi ID for key generation
 * @param theme - Sprite sheet theme config (ids, src, w, h)
 * @param points - Array of point DTOs with `id` field
 * @param color - CSS color for the pin tail
 * @param imageLoader - Async function to load the sprite sheet image
 * @returns Map keyed by `sprite-{bangumiId}-{pointId}` with ImageData + dimensions
 */
export async function cutSpriteSheet(
  bangumiId: number,
  theme: AnitabiTheme,
  points: ReadonlyArray<{ id: string }>,
  color: string,
  imageLoader: ImageLoader,
): Promise<Map<string, SpriteRenderResult>> {
  const result = new Map<string, SpriteRenderResult>();

  // Validate theme
  if (!isValidTheme(theme)) {
    return result;
  }

  const ids = theme.ids;
  if (ids.length === 0) {
    return result;
  }

  const w = theme.w ?? DEFAULT_THEME_WIDTH;
  const h = theme.h ?? DEFAULT_THEME_HEIGHT;

  // Load sprite sheet image
  let sheetImage: HTMLImageElement;
  try {
    sheetImage = await imageLoader(theme.src);
  } catch {
    return result;
  }

  // Grid layout: cols = floor(sqrt(n))
  const cols = Math.floor(Math.sqrt(ids.length));
  if (cols === 0) return result;

  // Logical output size per sprite (thumbnail + pin tail)
  const outW = w;
  const outH = h + PIN_TAIL_HEIGHT;

  // Physical canvas size (retina)
  const canvasW = outW * PIXEL_RATIO;
  const canvasH = outH * PIXEL_RATIO;

  // Build a lookup from theme ID -> grid index.
  // theme.ids defines the grid order: ids[0] at grid position 0, etc.
  // Points are matched by their ID to their grid position.
  const themeIdToGridIndex = new Map<string, number>();
  for (let i = 0; i < ids.length; i++) {
    themeIdToGridIndex.set(ids[i], i);
  }

  // Cut each sprite whose point ID exists in the theme
  for (const point of points) {
    const gridIndex = themeIdToGridIndex.get(point.id);
    if (gridIndex === undefined) continue; // point not in sprite sheet

    // Source coordinates in the sprite sheet based on grid position
    const srcX = (gridIndex % cols) * w;
    const srcY = Math.floor(gridIndex / cols) * h;

    // Create a fresh canvas for each sprite
    const canvas = document.createElement('canvas');
    canvas.width = canvasW;
    canvas.height = canvasH;
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;

    ctx.save();
    ctx.scale(PIXEL_RATIO, PIXEL_RATIO);

    // Draw the thumbnail from the sprite sheet
    ctx.drawImage(sheetImage, srcX, srcY, w, h, 0, 0, w, h);

    // Draw colored pin tail below the thumbnail
    ctx.save();
    ctx.translate((w - 22) / 2, h); // center the 22px-wide pin path
    ctx.fillStyle = color;
    const pinPath = new Path2D(PIN_PATH);
    ctx.fill(pinPath);
    ctx.restore();

    ctx.restore();

    // Extract the rendered pixel data
    const imageData = ctx.getImageData(0, 0, canvasW, canvasH);

    const key = `sprite-${bangumiId}-${point.id}`;
    result.set(key, {
      imageData,
      width: outW,
      height: outH,
    });
  }

  return result;
}
