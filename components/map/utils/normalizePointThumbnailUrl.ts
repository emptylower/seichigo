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
    const url = new URL(raw, 'https://seichigo.com')
    const host = url.hostname.toLowerCase()
    const isAnitabiHost = host === 'anitabi.cn' || host.endsWith('.anitabi.cn')
    if (isAnitabiHost) {
      url.searchParams.delete('plan')
      // Add resize params if not present for optimized loading
      if (!url.searchParams.has('w')) {
        url.searchParams.set('w', '64')
      }
      if (!url.searchParams.has('q')) {
        url.searchParams.set('q', '60')
      }
    }
    return url.toString()
  } catch {
    return raw
  }
}
