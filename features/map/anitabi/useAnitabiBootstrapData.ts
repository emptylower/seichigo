import { useCallback, useEffect } from 'react'
import type { AnitabiBangumiCard, AnitabiBootstrapDTO, AnitabiMapTab } from '@/lib/anitabi/types'
import { createCacheStore } from '@/lib/anitabi/client/clientCache'
import { distanceMeters } from './geo'
import {
  CARD_LIST_PREFETCH_ROOT_MARGIN,
  CARD_PAGE_SIZE,
  MAP_PRELOAD_V2_ENABLED,
  filterBulkCardsBySearch,
  normalizeSearchKeyword,
} from './shared'
import { isValidGeoPair } from './media'

export function useAnitabiBootstrapData(ctx: any) {
  const {
    locale,
    initialBootstrap,
    tab,
    query,
    queryInput,
    selectedCity,
    userLocation,
    cacheStoreRef,
    setCacheStoreReady,
    setLoading,
    setCards,
    setLoadingMoreCards,
    setCardsLoadError,
    setBootstrap,
    tabCardsRef,
    loadedTabsRef,
    setTabCardsVersion,
    setNextChunkIndex,
    setHasMoreCards,
    cardFeedTokenRef,
    nextChunkIndex,
    loading,
    loadingMoreCards,
    hasMoreCards,
    label,
    warmupProgress,
    cacheStoreReady,
    resetWarmupTaskProgress,
    updateWarmupProgress,
    setWarmupUiBlocking,
    warmupBlockingUiRef,
    warmupAbortRef,
    warmupRunTokenRef,
    warmupAllTabsData,
    hydrateTabCardsFromCache,
    searchResult,
    setSearchResult,
    cardsContainerRef,
    cardsLoadMoreRef,
    warmPointIndexByBangumiIdRef,
    setTab,
    loadBootstrapFallbackRef,
    loadMeRef,
    setMeState,
  } = ctx

  const loadMe = useCallback(async () => {
    try {
      const pointRes = await fetch('/api/me/point-states', { method: 'GET' })
      if (pointRes.status === 401) {
        setMeState(null)
        return
      }

      if (!pointRes.ok) return
      const pointJson = await pointRes.json().catch(() => ({ items: [] }))

      setMeState({
        pointStates: Array.isArray(pointJson.items) ? pointJson.items : [],
      })
    } catch {
      // noop
    }
  }, [setMeState])

  useEffect(() => {
    loadMeRef.current = loadMe
  }, [loadMe, loadMeRef])

  const loadBootstrap = useCallback(async () => {
    const requestToken = cardFeedTokenRef.current + 1
    cardFeedTokenRef.current = requestToken
    setLoading(true)
    setCards([])
    setLoadingMoreCards(false)
    setCardsLoadError(null)
    try {
      const store = cacheStoreRef.current
      const canUseTabCache = tab !== 'nearby' && !query && !selectedCity
      if (canUseTabCache && store) {
        const cached = await store.getCards(tab).catch(() => null)
        if (cached && Array.isArray(cached.cards)) {
          if (requestToken !== cardFeedTokenRef.current) return
          setCards(cached.cards)
          tabCardsRef.current[tab] = cached.cards
          loadedTabsRef.current.add(tab)
          setTabCardsVersion((prev: number) => prev + 1)
          setNextChunkIndex(1)
          setHasMoreCards(false)
          return
        }
      }

      const params = new URLSearchParams()
      params.set('locale', locale)
      params.set('tab', tab)
      if (query) params.set('q', query)
      if (selectedCity) params.set('city', selectedCity)
      if (tab === 'nearby' && userLocation) {
        params.set('ulat', userLocation.lat.toFixed(6))
        params.set('ulng', userLocation.lng.toFixed(6))
      }

      const res = await fetch(`/api/anitabi/bootstrap?${params.toString()}`, { method: 'GET' })
      if (!res.ok) throw new Error('Failed to load bootstrap')
      const json = (await res.json()) as AnitabiBootstrapDTO
      if (requestToken !== cardFeedTokenRef.current) return
      setBootstrap(json)
      setCards(json.cards)
      tabCardsRef.current[tab] = json.cards
      loadedTabsRef.current.add(tab)
      setTabCardsVersion((prev: number) => prev + 1)
      setNextChunkIndex(1)
      setHasMoreCards(json.cards.length >= CARD_PAGE_SIZE)
      if (store && tab !== 'nearby' && !query && !selectedCity) {
        await store.putCards(tab, {
          datasetVersion: json.datasetVersion,
          tab,
          cards: json.cards,
          cachedAt: Date.now(),
        }).catch(() => null)
      }
    } finally {
      if (requestToken !== cardFeedTokenRef.current) return
      setLoading(false)
    }
  }, [
    cacheStoreRef,
    cardFeedTokenRef,
    loadedTabsRef,
    locale,
    query,
    selectedCity,
    setBootstrap,
    setCards,
    setCardsLoadError,
    setHasMoreCards,
    setLoading,
    setLoadingMoreCards,
    setNextChunkIndex,
    setTabCardsVersion,
    tab,
    tabCardsRef,
    userLocation,
  ])

  useEffect(() => {
    loadBootstrapFallbackRef.current = loadBootstrap
  }, [loadBootstrap, loadBootstrapFallbackRef])

  const loadMoreCards = useCallback(async () => {
    if (tab !== 'nearby') return
    if (loading || loadingMoreCards || !hasMoreCards) return
    if (!userLocation) return
    const requestToken = cardFeedTokenRef.current
    const params = new URLSearchParams()
    params.set('locale', locale)
    params.set('tab', tab)
    params.set('size', String(CARD_PAGE_SIZE))
    if (query) params.set('q', query)
    if (selectedCity) params.set('city', selectedCity)
    params.set('ulat', userLocation.lat.toFixed(6))
    params.set('ulng', userLocation.lng.toFixed(6))

    setLoadingMoreCards(true)
    setCardsLoadError(null)
    try {
      const res = await fetch(`/api/anitabi/chunks/${nextChunkIndex}?${params.toString()}`, { method: 'GET' })
      const json = (await res.json().catch(() => ({}))) as { items?: AnitabiBangumiCard[] }
      if (!res.ok) throw new Error(label.loadMoreFailed)
      if (requestToken !== cardFeedTokenRef.current) return

      const items = Array.isArray(json.items) ? json.items : []
      setCards((prev: AnitabiBangumiCard[]) => {
        const seen = new Set(prev.map((row) => row.id))
        const merged = prev.slice()
        for (const item of items) {
          if (seen.has(item.id)) continue
          seen.add(item.id)
          merged.push(item)
        }
        return merged
      })
      setNextChunkIndex((prev: number) => prev + 1)
      setHasMoreCards(items.length >= CARD_PAGE_SIZE)
    } catch {
      if (requestToken !== cardFeedTokenRef.current) return
      setCardsLoadError(label.loadMoreFailed)
    } finally {
      if (requestToken !== cardFeedTokenRef.current) return
      setLoadingMoreCards(false)
    }
  }, [
    cardFeedTokenRef,
    hasMoreCards,
    label.loadMoreFailed,
    loading,
    loadingMoreCards,
    locale,
    nextChunkIndex,
    query,
    selectedCity,
    setCards,
    setCardsLoadError,
    setHasMoreCards,
    setLoadingMoreCards,
    setNextChunkIndex,
    tab,
    userLocation,
  ])

  useEffect(() => {
    let cancelled = false
    createCacheStore().then((store) => {
      if (!cancelled) {
        cacheStoreRef.current = store
        setCacheStoreReady(true)
      }
    })
    return () => {
      cancelled = true
    }
  }, [cacheStoreRef, setCacheStoreReady])

  useEffect(() => {
    if (!cacheStoreReady) return
    if (!MAP_PRELOAD_V2_ENABLED) {
      setWarmupUiBlocking(false)
      loadBootstrap().catch(() => null)
      return
    }
    const ac = new AbortController()
    warmupRunTokenRef.current += 1
    warmupAbortRef.current?.abort()
    warmupAbortRef.current = ac
    ;(async () => {
      const hydratedFromCache = await hydrateTabCardsFromCache(ac.signal)
      if (ac.signal.aborted) return

      let hasCachedWarmPointData = false
      if (cacheStoreRef.current) {
        const cachedManifest = await cacheStoreRef.current.getPreloadManifest().catch(() => null)
        if (ac.signal.aborted) return
        const chunkCount = cachedManifest?.manifest?.chunkCount || 0
        if (chunkCount <= 0) {
          hasCachedWarmPointData = true
        } else {
          const firstChunk = await cacheStoreRef.current.getPreloadChunk(0).catch(() => null)
          if (ac.signal.aborted) return
          hasCachedWarmPointData = Boolean(firstChunk?.chunk?.items?.length)
        }
      }
      const runInBackground = hydratedFromCache && hasCachedWarmPointData
      if (!runInBackground) {
        setLoading(true)
        setCards([])
      } else {
        setLoading(false)
      }

      warmupAllTabsData({ signal: ac.signal, background: runInBackground }).catch(() => {
        if (ac.signal.aborted) return
        setCardsLoadError(label.loadMoreFailed)
        resetWarmupTaskProgress()
        updateWarmupProgress({ phase: 'idle', percent: 0, detail: '' })
        warmupBlockingUiRef.current = false
        setWarmupUiBlocking(false)
      })
    })().catch(() => null)
    return () => {
      warmupRunTokenRef.current += 1
      ac.abort()
      warmupBlockingUiRef.current = false
      setWarmupUiBlocking(false)
      if (warmupAbortRef.current === ac) warmupAbortRef.current = null
    }
  }, [
    cacheStoreReady,
    cacheStoreRef,
    hydrateTabCardsFromCache,
    label.loadMoreFailed,
    loadBootstrap,
    resetWarmupTaskProgress,
    setCards,
    setCardsLoadError,
    setLoading,
    setWarmupUiBlocking,
    updateWarmupProgress,
    warmupAbortRef,
    warmupAllTabsData,
    warmupBlockingUiRef,
    warmupRunTokenRef,
  ])

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (warmupProgress.phase !== 'loading') return

    type WarmupDebugWindow = Window & {
      __SEICHIGO_WARMUP_DEBUG__?: Record<string, unknown>
      __SEICHIGO_WARMUP_DEBUG_HISTORY__?: Array<Record<string, unknown>>
    }
    const target = window as WarmupDebugWindow
    const emitSnapshot = (reason: string, warn = false) => {
      const now = Date.now()
      const lastProgressAt = Number(ctx.warmupMetricRef.current.last_progress_at || 0)
      const idleMs = lastProgressAt > 0 ? now - lastProgressAt : 0
      const snapshot = {
        reason,
        now,
        idleMs,
        runToken: ctx.warmupMetricRef.current.warmup_run_token || 0,
        phase: ctx.warmupProgressRef.current.phase,
        percent: ctx.warmupProgressRef.current.percent,
        detail: ctx.warmupProgressRef.current.detail,
        taskProgress: ctx.warmupTaskProgressRef.current,
        metrics: { ...ctx.warmupMetricRef.current },
      }
      target.__SEICHIGO_WARMUP_DEBUG__ = snapshot
      const history = target.__SEICHIGO_WARMUP_DEBUG_HISTORY__ || []
      history.push(snapshot)
      if (history.length > 36) history.shift()
      target.__SEICHIGO_WARMUP_DEBUG_HISTORY__ = history
      if (warn) {
        console.warn('[warmup-debug]', snapshot)
      } else {
        console.debug('[warmup-debug]', snapshot)
      }
    }

    emitSnapshot('loading-start')
    const timer = window.setInterval(() => {
      const now = Date.now()
      const lastProgressAt = Number(ctx.warmupMetricRef.current.last_progress_at || 0)
      const idleMs = lastProgressAt > 0 ? now - lastProgressAt : 0
      ctx.warmupMetricRef.current.watchdog_last_tick = now
      ctx.warmupMetricRef.current.watchdog_idle_ms = idleMs
      emitSnapshot('watchdog-tick', idleMs >= ctx.WARMUP_STALL_WARN_MS)
    }, ctx.WARMUP_WATCHDOG_INTERVAL_MS)

    return () => {
      window.clearInterval(timer)
      emitSnapshot('loading-stop')
    }
  }, [ctx.WARMUP_STALL_WARN_MS, ctx.WARMUP_WATCHDOG_INTERVAL_MS, warmupProgress.phase])

  useEffect(() => {
    if (tab !== 'nearby') return
    const nearbyCards = tabCardsRef.current.nearby || []
    if (loadedTabsRef.current.has('nearby') || Object.prototype.hasOwnProperty.call(tabCardsRef.current, 'nearby')) {
      loadedTabsRef.current.add('nearby')
      const hasSyncedSearchResult = normalizeSearchKeyword(queryInput) === normalizeSearchKeyword(query)
      const rankedByLocation = userLocation
        ? nearbyCards
            .map((card: any) => {
              const preload = warmPointIndexByBangumiIdRef.current.get(card.id)
              let nearest: number | null = null
              if (preload?.points?.length) {
                for (const point of preload.points) {
                  if (!isValidGeoPair(point.geo)) continue
                  const dist = distanceMeters([userLocation.lng, userLocation.lat], [point.geo[1], point.geo[0]])
                  if (nearest == null || dist < nearest) nearest = dist
                }
              } else if (isValidGeoPair(card.geo)) {
                nearest = distanceMeters([userLocation.lng, userLocation.lat], [card.geo[1], card.geo[0]])
              }
              return {
                ...card,
                nearestDistanceMeters: nearest != null ? Math.round(nearest) : null,
              }
            })
            .sort((a: any, b: any) => {
              const aDist = a.nearestDistanceMeters
              const bDist = b.nearestDistanceMeters
              if (aDist != null && bDist != null && aDist !== bDist) return aDist - bDist
              if (aDist != null) return -1
              if (bDist != null) return 1
              return a.id - b.id
            })
        : nearbyCards
      setCards(filterBulkCardsBySearch(rankedByLocation, query, selectedCity, hasSyncedSearchResult ? searchResult : null))
      setHasMoreCards(false)
      setLoading(false)
      return
    }
    if (!userLocation) {
      setCards([])
      setHasMoreCards(false)
      setLoading(false)
      return
    }
    if (warmupProgress.phase === 'loading' && warmupProgress.percent < 100) return
    if (ctx.ssrBootstrapUsedRef.current && initialBootstrap && initialBootstrap.tab === tab) {
      ctx.ssrBootstrapUsedRef.current = false
      tabCardsRef.current.nearby = initialBootstrap.cards
      loadedTabsRef.current.add('nearby')
      setTabCardsVersion((prev: number) => prev + 1)
      setHasMoreCards((initialBootstrap?.cards.length ?? 0) >= CARD_PAGE_SIZE)
      return
    }
    loadBootstrap().catch(() => null)
  }, [
    initialBootstrap,
    loadBootstrap,
    loadedTabsRef,
    query,
    queryInput,
    searchResult,
    selectedCity,
    setCards,
    setHasMoreCards,
    setLoading,
    setTabCardsVersion,
    tab,
    tabCardsRef,
    userLocation,
    warmPointIndexByBangumiIdRef,
    warmupProgress.percent,
    warmupProgress.phase,
  ])

  useEffect(() => {
    if (tab === 'nearby') return
    const hasLocalTabCards = Object.prototype.hasOwnProperty.call(tabCardsRef.current, tab)
    const isTabLoaded = loadedTabsRef.current.has(tab) || hasLocalTabCards
    if (!isTabLoaded) {
      setCards([])
      setHasMoreCards(false)
      if (cacheStoreReady) {
        setLoading(warmupProgress.phase === 'loading' && warmupProgress.percent < 100)
      }
      return
    }
    loadedTabsRef.current.add(tab)
    const all = tabCardsRef.current[tab] || []
    const hasSyncedSearchResult = normalizeSearchKeyword(queryInput) === normalizeSearchKeyword(query)
    setCards(filterBulkCardsBySearch(all, query, selectedCity, hasSyncedSearchResult ? searchResult : null))
    setHasMoreCards(false)
    setLoading(false)
  }, [
    cacheStoreReady,
    loadedTabsRef,
    query,
    queryInput,
    searchResult,
    selectedCity,
    setCards,
    setHasMoreCards,
    setLoading,
    tab,
    tabCardsRef,
    warmupProgress.percent,
    warmupProgress.phase,
  ])

  useEffect(() => {
    if (loading || loadingMoreCards || !hasMoreCards) return
    const root = cardsContainerRef.current
    const target = cardsLoadMoreRef.current
    if (!root || !target) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return
        loadMoreCards().catch(() => null)
      },
      {
        root,
        rootMargin: CARD_LIST_PREFETCH_ROOT_MARGIN,
        threshold: 0,
      }
    )

    observer.observe(target)
    return () => observer.disconnect()
  }, [cardsContainerRef, cardsLoadMoreRef, hasMoreCards, loadMoreCards, loading, loadingMoreCards])

  useEffect(() => {
    let cancelled = false
    const run = () => {
      if (cancelled) return
      loadMe().catch(() => null)
    }

    const win = window as Window & {
      requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number
      cancelIdleCallback?: (handle: number) => void
    }

    if (typeof win.requestIdleCallback === 'function' && typeof win.cancelIdleCallback === 'function') {
      const id = win.requestIdleCallback(run, { timeout: 1200 })
      return () => {
        cancelled = true
        win.cancelIdleCallback?.(id)
      }
    }

    const timer = setTimeout(run, 280)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [loadMe])

  useEffect(() => {
    const q = queryInput.trim()
    if (!q) {
      setSearchResult({ bangumi: [], points: [], cities: [] })
      return
    }

    const ctrl = new AbortController()
    const t = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/anitabi/search?locale=${encodeURIComponent(locale)}&q=${encodeURIComponent(q)}`, {
          signal: ctrl.signal,
        })
        if (!res.ok) return
        const json = await res.json()
        setSearchResult({
          bangumi: Array.isArray(json.bangumi) ? json.bangumi : [],
          points: Array.isArray(json.points) ? json.points : [],
          cities: Array.isArray(json.cities) ? json.cities : [],
        })
      } catch {
        // ignore
      }
    }, 220)

    return () => {
      ctrl.abort()
      window.clearTimeout(t)
    }
  }, [locale, queryInput, setSearchResult])

  return {
    loadMe,
    loadBootstrap,
    loadMoreCards,
  }
}
