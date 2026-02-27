import type { AnitabiBangumiCard, AnitabiMapTab } from '../types'
import type { BulkCardsResponse, CacheStore, CachedCardsPayload } from './types'
import type { ProgressTracker } from './progressTracker'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LoadAllCardsOptions = {
  locale: string
  tab: AnitabiMapTab
  cacheStore: CacheStore
  progressTracker: ProgressTracker
  signal?: AbortSignal
}

export type LoadAllCardsResult = {
  cards: AnitabiBangumiCard[]
  datasetVersion: string
  fromCache: boolean
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Fetch bulk cards with streaming progress. Uses Content-Length for byte-level
 * progress when available; falls back to indeterminate (time-based) progress
 * when the header is stripped (e.g. CDN gzip).
 */
async function fetchWithProgress(
  url: string,
  progressTracker: ProgressTracker,
  signal?: AbortSignal,
): Promise<BulkCardsResponse> {
  const res = await fetch(url, { method: 'GET', signal })

  if (!res.ok) {
    throw new Error(`Bulk cards fetch failed: ${res.status}`)
  }

  const contentLength = res.headers.get('content-length')
  const total = contentLength ? parseInt(contentLength, 10) : null

  // If no body or no ReadableStream support, fall back to .json()
  if (!res.body) {
    progressTracker.update(0, null)
    const json = (await res.json()) as BulkCardsResponse
    progressTracker.update(1, 1)
    return json
  }

  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let loaded = 0

  progressTracker.update(0, total)

  for (;;) {
    if (signal?.aborted) {
      reader.cancel()
      throw new DOMException('Aborted', 'AbortError')
    }

    const { done, value } = await reader.read()
    if (done) break

    chunks.push(value)
    loaded += value.byteLength
    progressTracker.update(loaded, total)
  }

  // Decode and parse
  const merged = new Uint8Array(loaded)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }

  const text = new TextDecoder().decode(merged)
  return JSON.parse(text) as BulkCardsResponse
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * Orchestrates cache-first loading of bulk bangumi cards.
 *
 * Flow:
 * 1. Check IndexedDB cache via `cacheStore.getCards(tab)`
 * 2. If cache hit AND version matches → return cached cards immediately
 * 3. Regardless of cache hit → fetch `/api/anitabi/bulk-cards` in background
 * 4. On fetch complete → update cache, notify progress 100%
 * 5. Return fetched cards (or cached cards if fetch fails and cache was available)
 *
 * For the "nearby" tab, returns `null` to signal the caller should use
 * the existing bootstrap flow (nearby requires geo-based server query).
 */
export async function loadAllCards(
  options: LoadAllCardsOptions,
): Promise<LoadAllCardsResult | null> {
  const { locale, tab, cacheStore, progressTracker, signal } = options

  // "nearby" tab requires server-side geo sorting — skip bulk loader
  if (tab === 'nearby') {
    return null
  }

  progressTracker.reset()
  progressTracker.setPhase('loading')

  // ---- 1. Check cache ----
  const cached = await cacheStore.getCards(tab)
  const cachedVersion = await cacheStore.getVersion()

  const hasFreshCache =
    cached !== null &&
    cachedVersion !== null &&
    cached.datasetVersion === cachedVersion

  // ---- 2. If fresh cache → return immediately, refresh in background ----
  if (hasFreshCache) {
    progressTracker.setPhase('done')

    // Fire-and-forget background refresh (no await)
    backgroundRefresh(locale, tab, cacheStore, signal).catch(() => {
      // Silently ignore — cache is still valid
    })

    return {
      cards: cached.cards,
      datasetVersion: cached.datasetVersion,
      fromCache: true,
    }
  }

  // ---- 3. Cache miss → fetch with progress ----
  try {
    const url = `/api/anitabi/bulk-cards?locale=${encodeURIComponent(locale)}&tab=${encodeURIComponent(tab)}`
    const data = await fetchWithProgress(url, progressTracker, signal)

    // ---- 4. Update cache ----
    const payload: CachedCardsPayload = {
      datasetVersion: data.datasetVersion,
      tab,
      cards: data.items,
      cachedAt: Date.now(),
    }
    await cacheStore.putCards(tab, payload)

    progressTracker.setPhase('done')

    return {
      cards: data.items,
      datasetVersion: data.datasetVersion,
      fromCache: false,
    }
  } catch (err) {
    // If fetch fails but we have stale cache, return it
    if (cached !== null) {
      progressTracker.setPhase('done')
      return {
        cards: cached.cards,
        datasetVersion: cached.datasetVersion,
        fromCache: true,
      }
    }

    progressTracker.reset()
    throw err
  }
}

// ---------------------------------------------------------------------------
// Background refresh (fire-and-forget for cache-hit path)
// ---------------------------------------------------------------------------

async function backgroundRefresh(
  locale: string,
  tab: AnitabiMapTab,
  cacheStore: CacheStore,
  signal?: AbortSignal,
): Promise<void> {
  const url = `/api/anitabi/bulk-cards?locale=${encodeURIComponent(locale)}&tab=${encodeURIComponent(tab)}`
  const res = await fetch(url, { method: 'GET', signal })

  if (!res.ok) return

  const data = (await res.json()) as BulkCardsResponse

  const payload: CachedCardsPayload = {
    datasetVersion: data.datasetVersion,
    tab,
    cards: data.items,
    cachedAt: Date.now(),
  }
  await cacheStore.putCards(tab, payload)
}
