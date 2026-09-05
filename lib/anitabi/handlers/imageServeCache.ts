/**
 * Render-path cache policy shared by every imageServe render response.
 * §0 contract: browsers get a fresh window (max-age) plus shared-edge reuse
 * (s-maxage) with a week of stale revalidation; see
 * docs/superpowers/plans/2026-09-04-plan-page-round10-prewarm-always-on-and-snapshot-map-interaction.md
 */
export const RENDER_CACHE_CONTROL = 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800'

/**
 * If-None-Match comparison per RFC 9110 §13.1.2 (weak comparison, so
 * `W/"abc"` matches `"abc"` in either direction). Supports comma-separated
 * candidate lists and the `*` wildcard. Returns false for absent
 * header/etag.
 */
function stripWeakValidatorPrefix(etag: string): string {
  return etag.startsWith('W/') ? etag.slice(2) : etag
}

export function matchesIfNoneMatch(header: string | null | undefined, etag: string): boolean {
  const etagValue = stripWeakValidatorPrefix(String(etag || '').trim())
  const headerValue = String(header || '').trim()
  if (!etagValue || !headerValue) return false
  if (headerValue === '*') return true

  return headerValue.split(',').some((rawCandidate) => {
    const trimmedCandidate = rawCandidate.trim()
    if (trimmedCandidate === '*') return true
    const candidate = stripWeakValidatorPrefix(trimmedCandidate)
    if (!candidate) return false
    return candidate === etagValue
  })
}

/** 304 without body, carrying the same render Cache-Control and the validator. */
export function buildNotModifiedResponse(etag: string): Response {
  return new Response(null, {
    status: 304,
    headers: {
      ETag: etag,
      'Cache-Control': RENDER_CACHE_CONTROL,
    },
  })
}
