import type { AnitabiBangumiDTO } from '../types'
import type { CacheStore } from './types'

// ---------------------------------------------------------------------------
// requestIdleCallback shim (Safari / older browsers / SSR)
// ---------------------------------------------------------------------------

function scheduleIdle(cb: () => void, opts?: { timeout?: number }): void {
  if (typeof requestIdleCallback !== 'undefined') {
    requestIdleCallback(() => cb(), opts)
  } else {
    setTimeout(cb, 1)
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PrefetchOptions = {
  bangumiIds: number[]
  locale: string
  cacheStore: CacheStore
  concurrency?: number
  signal?: AbortSignal
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * Background-prefetch bangumi detail data into the L2 cache (IndexedDB)
 * during browser idle time.
 *
 * - Uses `requestIdleCallback` (with `setTimeout` fallback) to avoid
 *   blocking the main thread.
 * - Respects `navigator.connection.saveData` — skips entirely when true.
 * - Concurrency-limited (default 2) to keep network pressure low.
 * - Abortable via `signal`.
 * - Skips IDs already present in the cache store.
 */
export function startDetailPrefetch(options: PrefetchOptions): void {
  const { bangumiIds, locale, cacheStore, concurrency = 2, signal } = options

  if (signal?.aborted || bangumiIds.length === 0) return

  // Respect data-saver mode
  if (typeof navigator !== 'undefined') {
    const conn = (navigator as Navigator & {
      connection?: { saveData?: boolean }
    }).connection
    if (conn?.saveData) return
  }

  const queue = [...bangumiIds]
  let active = 0

  function drain(): void {
    while (queue.length > 0 && active < concurrency && !signal?.aborted) {
      const id = queue.shift()!
      active++

      scheduleIdle(
        () => {
          if (signal?.aborted) {
            active--
            return
          }

          prefetchOne(id, locale, cacheStore, signal)
            .catch(() => null)
            .finally(() => {
              active--
              drain()
            })
        },
        { timeout: 5000 },
      )
    }
  }

  drain()
}

// ---------------------------------------------------------------------------
// Single-item prefetch
// ---------------------------------------------------------------------------

async function prefetchOne(
  id: number,
  locale: string,
  cacheStore: CacheStore,
  signal?: AbortSignal,
): Promise<void> {
  // Skip if already cached in L2
  const existing = await cacheStore.getDetail(id)
  if (existing) return

  const url = `/api/anitabi/bangumi/${id}?locale=${encodeURIComponent(locale)}`

  // Fetch Priority API hint — not yet in TS lib types
  const res = await fetch(
    url,
    { method: 'GET', signal, priority: 'low' } as RequestInit,
  )

  if (!res.ok || signal?.aborted) return

  const json = (await res.json()) as AnitabiBangumiDTO
  if (signal?.aborted) return

  const version = await cacheStore.getVersion()
  if (!version) return

  await cacheStore.putDetail(id, {
    datasetVersion: version,
    bangumiId: id,
    detail: json,
    cachedAt: Date.now(),
  })
}
