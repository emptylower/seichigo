/**
 * Anitabi theme sprite configuration
 */
export interface AnitabiTheme {
  /** Theme IDs that use this sprite */
  ids: string[];
  /** Sprite image URL */
  src: string;
  /** Sprite width in pixels (optional, defaults to DEFAULT_THEME_WIDTH) */
  w?: number;
  /** Sprite height in pixels (optional, defaults to DEFAULT_THEME_HEIGHT) */
  h?: number;
}

export const DEFAULT_THEME_WIDTH = 72;
export const DEFAULT_THEME_HEIGHT = 54;

/**
 * Runtime type guard for AnitabiTheme
 */
export function isValidTheme(value: unknown): value is AnitabiTheme {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const obj = value as Record<string, unknown>;

  // Validate ids: non-empty array of strings
  if (!Array.isArray(obj.ids) || obj.ids.length === 0) {
    return false;
  }
  if (!obj.ids.every((id) => typeof id === 'string')) {
    return false;
  }

  // Validate src: non-empty string
  if (typeof obj.src !== 'string' || obj.src.length === 0) {
    return false;
  }

  // Validate w: optional positive number
  if (obj.w !== undefined) {
    if (typeof obj.w !== 'number' || obj.w <= 0) {
      return false;
    }
  }

  // Validate h: optional positive number
  if (obj.h !== undefined) {
    if (typeof obj.h !== 'number' || obj.h <= 0) {
      return false;
    }
  }

  return true;
}

/**
 * Map display mode
 */
export type MapMode = 'complete' | 'simple'

/**
 * Base properties for point features
 */
export type PointFeatureProperties = {
  pointId: string
  color: string
  selected: number
  userState: string
}

/**
 * Properties for global point features with additional metadata
 */
export type GlobalPointFeatureProperties = PointFeatureProperties & {
  bangumiId: number
  imageUrl: string | null
}

/**
 * State for managing thumbnail image loading
 */
export type ThumbnailLoadState = {
  loaded: Map<string, HTMLImageElement>
  pending: Set<string>
  queue: string[]
}

/**
 * Properties for cluster features
 */
export type ClusterFeatureProperties = {
  cluster: boolean
  cluster_id: number
  point_count: number
}
