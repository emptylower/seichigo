import { toMapDisplayImageUrl } from '@/lib/anitabi/imageProxy'

/**
 * Normalize point thumbnail URL for optimized loading.
 * 
 * Point thumbnails are rendered through our image proxy so browser clients do
 * not depend on direct Anitabi availability.
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
