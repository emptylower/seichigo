import { toMapDisplayImageUrl } from '@/lib/anitabi/imageProxy'

/**
 * Normalize point thumbnail URL for optimized loading.
 * 
 * For anitabi.cn hosts:
 * - Removes ?plan= param
 * - Adds ?w=64&q=60 if not already present
 * 
 * For other hosts:
 * - Returns URL as-is
 * 
 * @param input - Raw URL string (may be null/undefined/empty)
 * @returns Normalized URL string or null if input is empty
 */
export function normalizePointThumbnailUrl(input: string | null | undefined): string | null {
  const raw = String(input || '').trim()
  if (!raw) return null

  try {
    const canonicalInput = raw.startsWith('/') ? `https://www.anitabi.cn${raw}` : raw
    return toMapDisplayImageUrl(canonicalInput, { kind: 'point-thumbnail' })
  } catch {
    return raw
  }
}
