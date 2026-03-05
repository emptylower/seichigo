import { toCanvasSafeImageUrl } from '@/lib/anitabi/imageProxy'

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
    const url = new URL(raw, raw.startsWith('/') ? 'https://www.anitabi.cn' : 'https://seichigo.com')
    const host = url.hostname.toLowerCase()
    const isAnitabiHost = host === 'anitabi.cn' || host.endsWith('.anitabi.cn')
    if (isAnitabiHost) {
      // Canonicalize to image.anitabi.cn (CORS-friendly) for map icon loading.
      if (host === 'anitabi.cn' || host === 'www.anitabi.cn') {
        url.hostname = 'image.anitabi.cn'
      }
      if (url.pathname.startsWith('/images/')) {
        url.pathname = url.pathname.slice('/images'.length)
      }

      // anitabi hosts use `plan` for real thumbnail variants.
      // Keep existing plan when present; otherwise default to a small one.
      const plan = url.searchParams.get('plan')
      if (!plan || !plan.trim()) {
        url.searchParams.set('plan', 'h160')
      }
      // Avoid mixing `plan` with free-form resize params that can unexpectedly
      // return full-size assets on some anitabi hosts.
      url.searchParams.delete('w')
      url.searchParams.delete('h')
      url.searchParams.delete('q')

      // Directly use image.anitabi.cn to avoid proxy bottlenecks/timeouts.
      return url.toString()
    }
    return toCanvasSafeImageUrl(url.toString())
  } catch {
    return raw
  }
}
