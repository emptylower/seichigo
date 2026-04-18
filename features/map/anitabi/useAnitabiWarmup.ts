import { useCallback } from 'react'
import type {
  AnitabiBangumiCard,
  AnitabiMapTab,
  AnitabiPreloadChunkItemDTO,
  AnitabiPreloadManifestDTO,
} from '@/lib/anitabi/types'
import {
  createFirstViewSlotKey,
  getFirstViewTrackedSlotCount,
  markFirstViewRequestStart,
} from './firstView'
import { withPromiseTimeout, createRequestSignalWithTimeout, yieldToMainThread, normalizeCoverImageUrl, normalizePointImageUrl, prefetchImageUrl, buildWarmDetail, getImageWarmupConcurrency } from './media'
import {
  COMPLETE_MODE_SPRITE_BUDGET_MS,
  MAP_PRELOAD_V2_ENABLED,
  PRELOAD_CHUNK_CONCURRENCY,
  PRELOAD_IMAGE_BACKGROUND_MAX,
  PRELOAD_IMAGE_BLOCKING_MAX,
  WARMUP_ACTIVE_DETAIL_IMAGE_MAX,
  WARMUP_BLOCKING_BUDGET_MS,
  WARMUP_IMAGE_TIMEOUT_MS,
  WARMUP_MAP_READY_TIMEOUT_MS,
  WARMUP_MAP_WAIT_TIMEOUT_MS,
  WARMUP_PRELOAD_FETCH_TIMEOUT_MS,
  prefetchedPointImageUrls,
  prefetchingPointImageUrls,
} from './shared'

export function useAnitabiWarmup(ctx: any) {
  const {
    locale,
    label,
    mapRef,
    mapInitWaitersRef,
    cacheStoreRef,
    preloadManifestRef,
    warmPointIndexByBangumiIdRef,
    tabCardsRef,
    loadedTabsRef,
    setBootstrap,
    setLoading,
    setCardsLoadError,
    setWarmPointDataVersion,
    setTabCardsVersion,
    warmupRunTokenRef,
    warmupBlockingUiRef,
    setWarmupUiBlocking,
    warmupMetricRef,
    updateWarmupProgress,
    updateWarmupTask,
    completeAllWarmupTasks,
    resetWarmupTaskProgress,
  } = ctx

  const waitForMapInstance = useCallback((signal?: AbortSignal): Promise<any | null> => {
    if (mapRef.current) return Promise.resolve(mapRef.current)
    if (signal?.aborted || typeof window === 'undefined') return Promise.resolve(null)

    return new Promise((resolve) => {
      const onReady = () => {
        cleanup()
        resolve(mapRef.current)
      }
      const cleanup = () => {
        if (timeoutId != null) {
          window.clearTimeout(timeoutId)
          timeoutId = null
        }
        const idx = mapInitWaitersRef.current.indexOf(onReady)
        if (idx >= 0) mapInitWaitersRef.current.splice(idx, 1)
        if (signal) signal.removeEventListener('abort', onAbort)
      }
      const onAbort = () => {
        cleanup()
        resolve(null)
      }

      let timeoutId: number | null = window.setTimeout(() => {
        cleanup()
        resolve(mapRef.current)
      }, WARMUP_MAP_WAIT_TIMEOUT_MS)

      mapInitWaitersRef.current.push(onReady)
      if (signal) signal.addEventListener('abort', onAbort, { once: true })
    })
  }, [mapInitWaitersRef, mapRef])

  const preloadMapBaseLayer = useCallback(async (signal?: AbortSignal, runToken?: number) => {
    updateWarmupTask('map', { percent: 2, detail: label.preloadMapPreparing }, { runToken })
    const map = await waitForMapInstance(signal)
    if (!map || signal?.aborted) return

    await new Promise<void>((resolve) => {
      let finished = false
      const cleanup = () => {
        if (timeoutId != null) {
          window.clearTimeout(timeoutId)
          timeoutId = null
        }
        map.off('styledata', onStyleData)
        map.off('load', onLoadOrIdle)
        map.off('idle', onIdle)
        if (signal) signal.removeEventListener('abort', onAbort)
      }

      const finish = (percent = 100, detail = label.preloadMapDone) => {
        if (finished) return
        finished = true
        updateWarmupTask('map', { percent, detail }, { runToken })
        cleanup()
        resolve()
      }

      const onStyleData = () => {
        updateWarmupTask('map', { percent: 45, detail: label.preloadMapPreparing }, { runToken })
      }
      const onLoadOrIdle = () => {
        updateWarmupTask('map', { percent: 78, detail: label.preloadMapTiles }, { runToken })
      }
      const onIdle = () => {
        finish(100, label.preloadMapDone)
      }
      const onAbort = () => {
        finish(100, label.preloadMapDone)
      }

      let timeoutId: number | null = window.setTimeout(() => {
        finish(100, label.preloadMapDone)
      }, WARMUP_MAP_READY_TIMEOUT_MS)

      map.on('styledata', onStyleData)
      map.on('load', onLoadOrIdle)
      map.on('idle', onIdle)
      if (signal) signal.addEventListener('abort', onAbort, { once: true })

      if (map.isStyleLoaded()) onStyleData()
      try {
        if (map.areTilesLoaded()) {
          finish(100, label.preloadMapDone)
        }
      } catch {
        // noop
      }
    })
  }, [label.preloadMapDone, label.preloadMapPreparing, label.preloadMapTiles, updateWarmupTask, waitForMapInstance])

  const fetchPreloadManifest = useCallback(async (signal?: AbortSignal): Promise<AnitabiPreloadManifestDTO | null> => {
    const store = cacheStoreRef.current
    if (!store) return null

    const cached: any = await withPromiseTimeout(
      store.getPreloadManifest().catch(() => null),
      3500,
      null,
      signal,
    )
    const fallback = cached?.manifest || null
    if (fallback) preloadManifestRef.current = fallback

    try {
      const { signal: requestSignal, cleanup } = createRequestSignalWithTimeout(signal, WARMUP_PRELOAD_FETCH_TIMEOUT_MS)
      let res: Response
      try {
        res = await fetch(`/api/anitabi/preload/manifest?locale=${encodeURIComponent(locale)}`, {
          method: 'GET',
          signal: requestSignal,
        })
      } finally {
        cleanup()
      }
      if (!res.ok) throw new Error('load preload manifest failed')
      const manifest = (await res.json()) as AnitabiPreloadManifestDTO
      preloadManifestRef.current = manifest
      await store.putPreloadManifest({
        datasetVersion: manifest.datasetVersion,
        manifest,
        cachedAt: Date.now(),
      }).catch(() => null)
      return manifest
    } catch {
      return fallback
    }
  }, [cacheStoreRef, locale, preloadManifestRef])

  const fetchPreloadChunkByIndex = useCallback(async (
    manifest: AnitabiPreloadManifestDTO,
    index: number,
    signal?: AbortSignal,
  ): Promise<AnitabiPreloadChunkItemDTO[]> => {
    const store = cacheStoreRef.current
    if (!store) return []

    const cached: any = await withPromiseTimeout(
      store.getPreloadChunk(index).catch(() => null),
      3500,
      null,
      signal,
    )
    if (cached && cached.datasetVersion === manifest.datasetVersion && Array.isArray(cached.chunk.items)) {
      return cached.chunk.items
    }

    const { signal: requestSignal, cleanup } = createRequestSignalWithTimeout(signal, WARMUP_PRELOAD_FETCH_TIMEOUT_MS)
    let res: Response
    try {
      res = await fetch(
        `/api/anitabi/preload/chunks/${index}?locale=${encodeURIComponent(locale)}`,
        { method: 'GET', signal: requestSignal },
      )
    } finally {
      cleanup()
    }
    if (!res.ok) throw new Error(`load preload chunk failed: ${index}`)
    const chunk = await res.json() as {
      datasetVersion: string
      index: number
      items?: AnitabiPreloadChunkItemDTO[]
    }
    if (chunk.datasetVersion && chunk.datasetVersion !== manifest.datasetVersion) {
      return []
    }
    const safeItems = Array.isArray(chunk.items) ? chunk.items : []
    await store.putPreloadChunk(index, {
      datasetVersion: manifest.datasetVersion,
      index,
      chunk: {
        datasetVersion: manifest.datasetVersion,
        index,
        items: safeItems,
      },
      cachedAt: Date.now(),
    }).catch(() => null)
    return safeItems
  }, [cacheStoreRef, locale])

  const hydrateTabCardsFromManifest = useCallback((manifest: AnitabiPreloadManifestDTO) => {
    preloadManifestRef.current = manifest
    tabCardsRef.current.nearby = Array.isArray(manifest.tabs.nearby) ? manifest.tabs.nearby : []
    tabCardsRef.current.latest = Array.isArray(manifest.tabs.latest) ? manifest.tabs.latest : []
    tabCardsRef.current.recent = Array.isArray(manifest.tabs.recent) ? manifest.tabs.recent : []
    tabCardsRef.current.hot = Array.isArray(manifest.tabs.hot) ? manifest.tabs.hot : []
    loadedTabsRef.current.add('nearby')
    loadedTabsRef.current.add('latest')
    loadedTabsRef.current.add('recent')
    loadedTabsRef.current.add('hot')
    setBootstrap((prev: any) => (prev ? { ...prev, datasetVersion: manifest.datasetVersion } : prev))
    setTabCardsVersion((prev: number) => prev + 1)

    const store = cacheStoreRef.current
    if (store) {
      const cachedAt = Date.now()
      const tabsToPersist: Array<{ tab: AnitabiMapTab; cards: AnitabiBangumiCard[] }> = [
        { tab: 'nearby', cards: tabCardsRef.current.nearby || [] },
        { tab: 'latest', cards: tabCardsRef.current.latest || [] },
        { tab: 'recent', cards: tabCardsRef.current.recent || [] },
        { tab: 'hot', cards: tabCardsRef.current.hot || [] },
      ]
      void Promise.all(
        tabsToPersist.map(({ tab, cards }) =>
          store.putCards(tab, {
            datasetVersion: manifest.datasetVersion,
            tab,
            cards,
            cachedAt,
          }).catch(() => null)
        )
      )
    }
  }, [cacheStoreRef, loadedTabsRef, preloadManifestRef, setBootstrap, setTabCardsVersion, tabCardsRef])

  const hydrateTabCardsFromCache = useCallback(async (signal?: AbortSignal): Promise<boolean> => {
    const store = cacheStoreRef.current
    if (!store || signal?.aborted) return false

    let hydrated = false
    const cachedManifest = await store.getPreloadManifest().catch(() => null)
    if (signal?.aborted) return false
    if (cachedManifest?.manifest) {
      preloadManifestRef.current = cachedManifest.manifest
      const manifestTabs = cachedManifest.manifest.tabs
      tabCardsRef.current.nearby = Array.isArray(manifestTabs.nearby) ? manifestTabs.nearby : []
      tabCardsRef.current.latest = Array.isArray(manifestTabs.latest) ? manifestTabs.latest : []
      tabCardsRef.current.recent = Array.isArray(manifestTabs.recent) ? manifestTabs.recent : []
      tabCardsRef.current.hot = Array.isArray(manifestTabs.hot) ? manifestTabs.hot : []
      loadedTabsRef.current.add('nearby')
      loadedTabsRef.current.add('latest')
      loadedTabsRef.current.add('recent')
      loadedTabsRef.current.add('hot')
      hydrated = true
    }

    const tabs: AnitabiMapTab[] = ['nearby', 'latest', 'recent', 'hot']
    const cachedTabs = await Promise.all(
      tabs.map((tabKey) => store.getCards(tabKey).catch(() => null))
    )
    if (signal?.aborted) return hydrated
    for (let idx = 0; idx < tabs.length; idx += 1) {
      const tabKey = tabs[idx]!
      const payload = cachedTabs[idx]
      if (!payload || !Array.isArray(payload.cards)) continue
      tabCardsRef.current[tabKey] = payload.cards
      loadedTabsRef.current.add(tabKey)
      hydrated = true
    }

    if (hydrated) {
      setTabCardsVersion((prev: number) => prev + 1)
      setLoading(false)
    }
    return hydrated
  }, [cacheStoreRef, loadedTabsRef, preloadManifestRef, setLoading, setTabCardsVersion, tabCardsRef])

  const warmupAllTabsData = useCallback(async (options?: {
    signal?: AbortSignal
    background?: boolean
  }) => {
    const signal = options?.signal
    const background = Boolean(options?.background)
    const store = cacheStoreRef.current
    if (!store || signal?.aborted) return
    const runToken = warmupRunTokenRef.current + 1
    warmupRunTokenRef.current = runToken
    const isActiveRun = () => warmupRunTokenRef.current === runToken
    const updateProgressSafe = (next: any) => {
      updateWarmupProgress(next, { runToken })
    }
    const updateTaskSafe = (key: any, next: any) => {
      updateWarmupTask(key, next, { runToken })
    }
    const completeTasksSafe = () => {
      completeAllWarmupTasks({ runToken })
    }

    const startedAt = performance.now()
    warmupBlockingUiRef.current = !background
    setWarmupUiBlocking(!background)
    setCardsLoadError(null)
    warmupMetricRef.current.warmup_run_token = runToken
    warmupMetricRef.current.warmup_session_started_at = Date.now()
    warmupMetricRef.current.warmup_session_background = background ? 1 : 0
    warmupMetricRef.current.last_progress_at = Date.now()
    warmupMetricRef.current.last_progress_key = 'map'
    warmupMetricRef.current.last_progress_percent = 0
    warmupMetricRef.current.last_progress_detail = label.preloadMapPreparing
    warmupMetricRef.current.promise_map_state = 0
    warmupMetricRef.current.promise_manifest_state = 0
    warmupMetricRef.current.promise_details_state = 0
    warmupMetricRef.current.promise_images_state = 0
    warmupMetricRef.current.details_chunk_done = 0
    warmupMetricRef.current.details_chunk_total = 0
    warmupMetricRef.current.details_points_loaded = 0
    warmupMetricRef.current.images_inflight = 0
    warmupMetricRef.current.images_last_src = ''
    warmupMetricRef.current.images_done = 0
    warmupMetricRef.current.images_total = 0
    warmupMetricRef.current.images_queue_remaining = 0
    warmupMetricRef.current.images_blocking_truncated = 0
    resetWarmupTaskProgress()
    updateProgressSafe({ phase: 'loading', percent: 0, detail: label.preloadMapPreparing })
    updateTaskSafe('cards', { percent: 0, detail: `${label.preloadCards} (0/0)` })
    updateTaskSafe('details', { percent: 0, detail: `${label.preloadDetails} (0/0)` })
    updateTaskSafe('images', { percent: 0, detail: `${label.preloadImages} (0/0)` })
    if (signal?.aborted || !isActiveRun()) return

    const mapStartedAt = performance.now()
    warmupMetricRef.current.promise_map_state = 1
    const mapWarmupPromise = preloadMapBaseLayer(signal, runToken)
      .then(() => {
        warmupMetricRef.current.promise_map_state = 2
      })
      .catch((error) => {
        warmupMetricRef.current.promise_map_state = -1
        throw error
      })
      .finally(() => {
        warmupMetricRef.current.map_ms = Math.round(performance.now() - mapStartedAt)
      })

    warmupMetricRef.current.promise_manifest_state = 1
    const manifestPromise = (async (): Promise<AnitabiPreloadManifestDTO> => {
      const manifestStartedAt = performance.now()
      const manifest = await fetchPreloadManifest(signal)
      if (signal?.aborted || !isActiveRun()) throw new Error('aborted')
      if (!manifest) throw new Error('preload manifest unavailable')
      warmupMetricRef.current.manifest_ms = Math.round(performance.now() - manifestStartedAt)
      updateTaskSafe('cards', { percent: 25, detail: `${label.preloadCards} (1/4)` })
      hydrateTabCardsFromManifest(manifest)
      updateTaskSafe('cards', { percent: 100, detail: `${label.preloadCards} (4/4)` })
      setLoading(false)
      return manifest
    })()
      .then((manifest) => {
        warmupMetricRef.current.promise_manifest_state = 2
        return manifest
      })
      .catch((error) => {
        warmupMetricRef.current.promise_manifest_state = -1
        throw error
      })

    warmupMetricRef.current.promise_details_state = 1
    const detailsWarmupPromise = (async () => {
      const manifest = await manifestPromise
      if (signal?.aborted || !isActiveRun()) return

      const chunkCount = Math.max(0, manifest.chunkCount)
      warmupMetricRef.current.details_chunk_total = chunkCount
      warmPointIndexByBangumiIdRef.current.clear()
      setWarmPointDataVersion((prev: number) => prev + 1)
      const chunkQueue = Array.from({ length: chunkCount }, (_, idx) => idx)
      let chunkDone = 0
      let pointsLoaded = 0
      let lastVisualSyncAt = 0
      if (chunkCount > 0) {
        updateTaskSafe('details', { percent: 0, detail: `${label.preloadDetails} (0/${chunkCount})` })
        const chunkStartedAt = performance.now()
        const workers = Math.min(PRELOAD_CHUNK_CONCURRENCY, chunkQueue.length)
        await Promise.all(Array.from({ length: workers }, async () => {
          for (;;) {
            if (signal?.aborted || !isActiveRun()) return
            const index = chunkQueue.shift()
            if (index == null) return

            const items = await withPromiseTimeout(
              fetchPreloadChunkByIndex(manifest, index, signal).catch(() => [] as AnitabiPreloadChunkItemDTO[]),
              WARMUP_PRELOAD_FETCH_TIMEOUT_MS + 1200,
              [] as AnitabiPreloadChunkItemDTO[],
              signal,
            )
            if (signal?.aborted || !isActiveRun()) return
            for (const item of items) {
              warmPointIndexByBangumiIdRef.current.set(item.bangumiId, item)
              pointsLoaded += item.points.length
            }

            chunkDone += 1
            warmupMetricRef.current.details_chunk_done = chunkDone
            warmupMetricRef.current.details_points_loaded = pointsLoaded
            updateTaskSafe('details', {
              percent: Math.round((chunkDone / chunkCount) * 100),
              detail: `${label.preloadDetails} (${chunkDone}/${chunkCount}) · ${pointsLoaded}`,
            })

            const now = performance.now()
            if (chunkDone === 1 || chunkDone === chunkCount || now - lastVisualSyncAt >= 900) {
              lastVisualSyncAt = now
              setTabCardsVersion((prev: number) => prev + 1)
              setWarmPointDataVersion((prev: number) => prev + 1)
            }
            if (chunkDone % 2 === 0) {
              await yieldToMainThread(signal)
            }
          }
        }))
        warmupMetricRef.current.chunks_ms = Math.round(performance.now() - chunkStartedAt)
      } else {
        updateTaskSafe('details', { percent: 100, detail: `${label.preloadDetails} (0/0)` })
      }

      if (signal?.aborted || !isActiveRun()) return
      const activeId = ctx.activeBangumiIdRef.current
      if (activeId == null) return
      const activeCard = Object.values(tabCardsRef.current).flatMap((rows: any) => rows || []).find((row: any) => row.id === activeId)
      const activeChunk = warmPointIndexByBangumiIdRef.current.get(activeId) || null
      if (!activeCard || !activeChunk) return
      ctx.setDetail((prev: any) => {
        if (!prev || prev.card.id !== activeCard.id) return prev
        if (prev.points.length > 0) return prev
        return buildWarmDetail(activeCard, activeChunk)
      })
    })()
      .then(() => {
        warmupMetricRef.current.promise_details_state = 2
      })
      .catch((error) => {
        warmupMetricRef.current.promise_details_state = -1
        throw error
      })

    warmupMetricRef.current.promise_images_state = 1
    const imagesWarmupPromise = (async () => {
      const manifest = await manifestPromise
      if (signal?.aborted || !isActiveRun()) return

      const blockingImages = new Set<string>()
      const queueCovers: Array<{ src: string; slotKey: string | null }> = []
      const pushBlockingImage = (
        src: string | null | undefined,
        targetQueue: Array<{ src: string; slotKey: string | null }>,
        slotKey: string | null = null,
      ) => {
        const value = String(src || '').trim()
        if (!value || blockingImages.has(value) || prefetchedPointImageUrls.has(value) || prefetchingPointImageUrls.has(value)) return
        if (blockingImages.size >= PRELOAD_IMAGE_BLOCKING_MAX) return
        blockingImages.add(value)
        targetQueue.push({ src: value, slotKey })
      }

      const preferredTabs: AnitabiMapTab[] = ['latest', 'recent', 'hot', 'nearby']
      const currentTabCards = tabCardsRef.current[ctx.tab] || []
      const firstViewTrackedCount = getFirstViewTrackedSlotCount(typeof window !== 'undefined' ? window.innerWidth : 1440)
      const firstViewCards = currentTabCards.slice(0, firstViewTrackedCount)
      const currentTabOverflow = currentTabCards.slice(firstViewTrackedCount, 40)

      for (const card of firstViewCards) {
        pushBlockingImage(
          normalizeCoverImageUrl(card.cover),
          queueCovers,
          createFirstViewSlotKey('cover', card.id),
        )
      }
      for (const card of currentTabOverflow) {
        pushBlockingImage(normalizeCoverImageUrl(card.cover), queueCovers)
      }
      for (const tabKey of preferredTabs) {
        const rows = manifest.tabs[tabKey] || []
        for (const card of rows.slice(0, 28)) {
          pushBlockingImage(normalizeCoverImageUrl(card.cover), queueCovers)
        }
      }
      warmupMetricRef.current.first_view_warmup_cover_count = firstViewCards.length

      let done = 0
      let inFlight = 0
      const deadline = Date.now() + WARMUP_BLOCKING_BUDGET_MS
      const updateImagesProgress = (total: number, force = false) => {
        if (total <= 0) {
          updateTaskSafe('images', { percent: 100, detail: `${label.preloadImages} (0/0)` })
          return
        }
        const clampedDone = Math.min(done, total)
        const percentRaw = Math.floor((clampedDone / total) * 100)
        const percent = clampedDone >= total ? 100 : Math.max(0, Math.min(99, percentRaw))
        if (!force && clampedDone !== total && clampedDone % 8 !== 0) return
        updateTaskSafe('images', {
          percent,
          detail: `${label.preloadImages} (${clampedDone}/${total})`,
        })
      }
      const runQueue = async (queue: Array<{ src: string; slotKey: string | null }>, total: number) => {
        if (!queue.length || total <= 0) return
        warmupMetricRef.current.images_total = total
        warmupMetricRef.current.images_queue_remaining = queue.length
        const workers = Math.min(getImageWarmupConcurrency(false), queue.length)
        await Promise.all(Array.from({ length: workers }, async () => {
          for (;;) {
            if (signal?.aborted || Date.now() > deadline || !isActiveRun()) return
            const entry = queue.shift()
            if (!entry) return
            warmupMetricRef.current.images_queue_remaining = queue.length
            inFlight += 1
            warmupMetricRef.current.images_inflight = inFlight
            warmupMetricRef.current.images_last_src = entry.src
            try {
              if (entry.slotKey) {
                markFirstViewRequestStart(warmupMetricRef, {
                  slotKey: entry.slotKey,
                  slotType: 'cover-avatar',
                  src: entry.src,
                  owner: 'warmup',
                })
              }
              await withPromiseTimeout(
                prefetchImageUrl(entry.src, { signal, timeoutMs: WARMUP_IMAGE_TIMEOUT_MS }).catch(() => null),
                WARMUP_IMAGE_TIMEOUT_MS + 300,
                undefined,
                signal,
              )
            } finally {
              inFlight = Math.max(0, inFlight - 1)
              warmupMetricRef.current.images_inflight = inFlight
            }
            if (signal?.aborted || !isActiveRun()) return
            done += 1
            warmupMetricRef.current.images_done = done
            updateImagesProgress(total)
            if (done % 6 === 0) {
              await yieldToMainThread(signal)
            }
          }
        }))
      }

      updateTaskSafe('images', { percent: 0, detail: `${label.preloadImages} (0/${queueCovers.length})` })
      await runQueue(queueCovers, queueCovers.length)
      if (signal?.aborted || !isActiveRun()) return
      if (Date.now() > deadline) {
        warmupMetricRef.current.images_blocking_truncated = 1
        updateImagesProgress(queueCovers.length, true)
        return
      }

      await detailsWarmupPromise
      if (signal?.aborted || !isActiveRun()) return
      if (Date.now() > deadline) {
        warmupMetricRef.current.images_blocking_truncated = 1
        updateImagesProgress(queueCovers.length, true)
        return
      }

      const queueActive: Array<{ src: string; slotKey: string | null }> = []
      const activeId = ctx.activeBangumiIdRef.current
      if (activeId != null) {
        const item = warmPointIndexByBangumiIdRef.current.get(activeId) || null
        if (item) {
          for (const point of item.points.slice(0, ctx.WARMUP_ACTIVE_DETAIL_IMAGE_MAX || WARMUP_ACTIVE_DETAIL_IMAGE_MAX)) {
            pushBlockingImage(normalizePointImageUrl(point.image), queueActive)
          }
        }
      }

      const total = done + queueActive.length
      if (total <= 0) {
        updateTaskSafe('images', { percent: 100, detail: `${label.preloadImages} (0/0)` })
        return
      }
      if (queueActive.length > 0) {
        updateImagesProgress(total, true)
      }
      await runQueue(queueActive, total)
      if (signal?.aborted || !isActiveRun()) return
      if (Date.now() > deadline) {
        warmupMetricRef.current.images_blocking_truncated = 1
      }
      updateImagesProgress(total, true)
    })()
      .then(() => {
        warmupMetricRef.current.promise_images_state = 2
      })
      .catch((error) => {
        warmupMetricRef.current.promise_images_state = -1
        throw error
      })

    await Promise.all([mapWarmupPromise, detailsWarmupPromise, imagesWarmupPromise])
    if (signal?.aborted || !isActiveRun()) {
      if (isActiveRun()) {
        warmupMetricRef.current.warmup_aborted = 1
        warmupBlockingUiRef.current = false
        setWarmupUiBlocking(false)
        updateProgressSafe({ phase: 'idle', percent: 0, detail: '' })
      }
      return
    }

    completeTasksSafe()
    updateProgressSafe({ phase: 'done', percent: 100, detail: label.preloadDone })
    warmupBlockingUiRef.current = false
    setWarmupUiBlocking(false)
    warmupMetricRef.current.warmup_aborted = 0
    warmupMetricRef.current.unlock_ms = Math.round(performance.now() - startedAt)
    window.setTimeout(() => {
      if (!isActiveRun()) return
      ctx.setWarmupProgress((prev: any) => (prev.phase === 'done'
        ? { ...prev, phase: 'idle', percent: 100, detail: label.preloadDone }
        : prev))
    }, 700)

    const backgroundStartedAt = performance.now()
    const backgroundImages = new Set<string>()
    for (const rows of Object.values(tabCardsRef.current) as Array<AnitabiBangumiCard[] | undefined>) {
      for (const card of rows || []) {
        const cover = normalizeCoverImageUrl((card as any).cover)
        if (cover) backgroundImages.add(cover)
      }
    }
    for (const item of warmPointIndexByBangumiIdRef.current.values()) {
      for (const point of item.points) {
        const img = normalizePointImageUrl(point.image)
        if (img) backgroundImages.add(img)
        if (backgroundImages.size >= PRELOAD_IMAGE_BACKGROUND_MAX) break
      }
      if (backgroundImages.size >= PRELOAD_IMAGE_BACKGROUND_MAX) break
    }
    const bgQueue = Array.from(backgroundImages).filter((src) => !prefetchedPointImageUrls.has(src))
    if (!signal?.aborted && isActiveRun() && bgQueue.length > 0) {
      void Promise.all(Array.from({ length: Math.min(getImageWarmupConcurrency(true), bgQueue.length) }, async () => {
        for (;;) {
          if (signal?.aborted || !isActiveRun()) return
          const src = bgQueue.shift()
          if (!src) return
          await prefetchImageUrl(src, { signal, timeoutMs: 2200 }).catch(() => null)
        }
      })).finally(() => {
        warmupMetricRef.current.bg_images_ms = Math.round(performance.now() - backgroundStartedAt)
      })
    } else {
      warmupMetricRef.current.bg_images_ms = 0
    }
  }, [
    cacheStoreRef,
    completeAllWarmupTasks,
    fetchPreloadChunkByIndex,
    fetchPreloadManifest,
    hydrateTabCardsFromManifest,
    label.preloadCards,
    label.preloadDetails,
    label.preloadDone,
    label.preloadImages,
    label.preloadMapPreparing,
    preloadMapBaseLayer,
    resetWarmupTaskProgress,
    setBootstrap,
    setCardsLoadError,
    setLoading,
    setTabCardsVersion,
    setWarmPointDataVersion,
    setWarmupUiBlocking,
    tabCardsRef,
    updateWarmupProgress,
    updateWarmupTask,
    warmPointIndexByBangumiIdRef,
    warmupBlockingUiRef,
    warmupMetricRef,
    warmupRunTokenRef,
  ])

  return {
    hydrateTabCardsFromCache,
    warmupAllTabsData,
  }
}
