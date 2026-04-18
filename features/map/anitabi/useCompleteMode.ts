import { useEffect } from 'react'
import type { AnitabiBangumiCard } from '@/lib/anitabi/types'
import { toCanvasSafeImageUrl } from '@/lib/anitabi/imageProxy'
import { isValidTheme } from '@/components/map/types'
import { createGlobalFeatureCollection } from '@/components/map/utils/globalFeatureCollection'
import { cutSpriteSheet } from '@/components/map/utils/spriteRenderer'
import { CoverAvatarLoader } from '@/components/map/utils/coverAvatarLoader'
import {
  COMPLETE_BANGUMI_COVERS_LAYER_ID,
  COMPLETE_DOTS_LAYER_ID,
  COMPLETE_ICONS_LAYER_ID,
  COMPLETE_POINT_IMAGES_LAYER_ID,
  COMPLETE_THEME_FALLBACK_LAYER_ID,
  buildLabelFeatureCollection,
  ensureCompleteModeSources,
  ensureCompleteModeSymbolLayer,
  ensureLabelLayer,
  removeCompleteModeLayers,
  removeLabelLayer,
  updateCompleteModeCoverSource,
  updateCompleteModeLayerVisibility,
  updateCompleteModePointImageSource,
  updateCompleteModeSources,
  updateCompleteModeThemeSource,
  updateLabelSource,
} from '@/components/map/CompleteModeLayers'
import { ThumbnailLoader } from '@/components/map/utils/thumbnailLoader'
import { computeWindowExcerpt } from './windowExcerpt'
import { yieldToMainThread } from './media'
import {
  getFirstViewTrackedSlotCount,
  markFirstViewRequestStart,
  markFirstViewSettlement,
} from './firstView'
import {
  COMPLETE_AVATAR_MAX_ZOOM,
  COMPLETE_DETAIL_THEME_MAX_ZOOM,
  COMPLETE_DETAIL_THEME_MIN_ZOOM,
  COMPLETE_MODE_COVER_CANDIDATES_MAX,
  COMPLETE_MODE_COVER_MAX_LOADED,
  COMPLETE_MODE_SPRITE_BUDGET_MS,
  COMPLETE_MODE_SPRITE_MAX_BANGUMI,
  COMPLETE_WINDOW_BANGUMI_EXCERPT_MAX,
  COMPLETE_WINDOW_EXCERPT_MIN_ZOOM,
  COMPLETE_WINDOW_POINT_EXCERPT_MAX,
} from './shared'
import type { AnitabiTheme, GlobalPointFeatureProperties } from '@/components/map/types'
import { isValidGeoPair } from './media'

export function useCompleteMode(ctx: any) {
  const {
    mapRef,
    mapMode,
    mapModeRef,
    mapReady,
    detail,
    detailRef,
    selectedPointId,
    warmupTaskProgress,
    warmPointDataVersion,
    completeImageBuildZoom,
    completeImageShowZoom,
    syncCompleteModeRef,
    completeFeatureCollectionRef,
    coverAvatarLoaderRef,
    completePointImageLoaderRef,
    completePointImageSyncTokenRef,
    loadedCoverIdsRef,
    completeCoverFeatureCollectionRef,
    completeCoverCandidatesRef,
    setWindowExcerptPoints,
    setWindowExcerptBangumis,
    tabCardsRef,
    warmPointIndexByBangumiIdRef,
    isDesktopRef,
    spriteImageIdsRef,
    completeBaseBuildVersionRef,
    completeSpriteBuildVersionRef,
    completeAbortRef,
    warmupMetricRef,
    setCompleteModeLoading,
  } = ctx

  const createTrackedMetricCallbacks = (slotType: 'point-thumbnail' | 'cover-avatar') => ({
    onTrackedSlotRequestStart: ({ slotKey, src }: { slotKey: string; src: string }) => {
      markFirstViewRequestStart(warmupMetricRef, {
        slotKey,
        slotType,
        src,
        owner: 'viewport-loader',
      })
    },
    onTrackedSlotSettle: ({ slotKey, src, state }: { slotKey: string; src: string; state: 'visible' | 'fallback' }) => {
      markFirstViewSettlement(warmupMetricRef, {
        slotKey,
        slotType,
        src,
        owner: 'viewport-loader',
        state,
      })
    },
  })

  useEffect(() => {
    const flushCompleteMode = () => {
      const map = mapRef.current
      if (!map || !map.isStyleLoaded()) return false

      const clearThumbImages = () => {
        const imageIds = map.listImages().filter((id: string) => id.startsWith('thumb-'))
        for (const imageId of imageIds) {
          if (map.hasImage(imageId)) {
            map.removeImage(imageId)
          }
        }
      }

      const clearPointImageSource = () => {
        updateCompleteModePointImageSource(map, { type: 'FeatureCollection', features: [] })
      }

      const clearThemeSource = () => {
        updateCompleteModeThemeSource(map, { type: 'FeatureCollection', features: [] })
      }

      const clearWindowExcerpt = () => {
        setWindowExcerptPoints([])
        setWindowExcerptBangumis([])
      }

      const fc = completeFeatureCollectionRef.current
      if (mapModeRef.current === 'simple') {
        removeCompleteModeLayers(map)
        removeLabelLayer(map)
        coverAvatarLoaderRef.current = null
        completePointImageLoaderRef.current = null
        completePointImageSyncTokenRef.current += 1
        clearThumbImages()
        loadedCoverIdsRef.current = new Set()
        completeCoverFeatureCollectionRef.current = null
        completeCoverCandidatesRef.current = []
        clearWindowExcerpt()
        return true
      }

      if (!fc || fc.features.length === 0) {
        removeCompleteModeLayers(map)
        removeLabelLayer(map)
        coverAvatarLoaderRef.current = null
        completePointImageLoaderRef.current = null
        completePointImageSyncTokenRef.current += 1
        clearThumbImages()
        loadedCoverIdsRef.current = new Set()
        completeCoverFeatureCollectionRef.current = null
        completeCoverCandidatesRef.current = []
        clearWindowExcerpt()
        return true
      }

      try {
        const currentZoom = map.getZoom()
        const detailBangumiId = detailRef.current?.card.id ?? null
        const focusedThemeMinZoom = detailBangumiId == null ? COMPLETE_DETAIL_THEME_MIN_ZOOM : 0
        const focusedImageShowZoom = detailBangumiId == null
          ? completeImageShowZoom
          : Math.max(COMPLETE_DETAIL_THEME_MIN_ZOOM + 0.2, completeImageShowZoom - 0.9)
        const focusedImageBuildZoom = detailBangumiId == null
          ? completeImageBuildZoom
          : Math.max(COMPLETE_DETAIL_THEME_MIN_ZOOM, completeImageBuildZoom - 0.9)

        ensureCompleteModeSources(map)
        ensureCompleteModeSymbolLayer(map, {
          avatarMaxZoom: COMPLETE_AVATAR_MAX_ZOOM,
          detailThemeMinZoom: focusedThemeMinZoom,
          imageShowZoom: focusedImageShowZoom,
        })
        if (map.getLayer(COMPLETE_ICONS_LAYER_ID)) {
          map.setLayerZoomRange(COMPLETE_ICONS_LAYER_ID, focusedThemeMinZoom, COMPLETE_DETAIL_THEME_MAX_ZOOM)
        }
        if (map.getLayer(COMPLETE_THEME_FALLBACK_LAYER_ID)) {
          map.setLayerZoomRange(COMPLETE_THEME_FALLBACK_LAYER_ID, focusedThemeMinZoom, COMPLETE_DETAIL_THEME_MAX_ZOOM)
        }
        if (map.getLayer(COMPLETE_POINT_IMAGES_LAYER_ID)) {
          map.setLayerZoomRange(COMPLETE_POINT_IMAGES_LAYER_ID, focusedImageShowZoom, 24)
        }
        updateCompleteModeSources(map, fc)

        const coverBase = completeCoverFeatureCollectionRef.current
        const coverCollection: GeoJSON.FeatureCollection = coverBase || { type: 'FeatureCollection', features: [] }
        updateCompleteModeCoverSource(map, coverCollection, loadedCoverIdsRef.current)

        if (coverAvatarLoaderRef.current && completeCoverCandidatesRef.current.length > 0) {
          const coverCandidates = completeCoverCandidatesRef.current
          void coverAvatarLoaderRef.current.updateViewport(coverCandidates).then((ids: Set<string>) => {
            loadedCoverIdsRef.current = ids
            const liveMap = mapRef.current
            if (!liveMap || !liveMap.isStyleLoaded()) return
            updateCompleteModeCoverSource(liveMap, coverCollection, ids)
            liveMap.triggerRepaint()
          }).catch(() => null)
        }

        const shouldShowCovers = detailBangumiId == null && currentZoom < COMPLETE_AVATAR_MAX_ZOOM
        const shouldShowThemeIcons = detailBangumiId != null && currentZoom < COMPLETE_DETAIL_THEME_MAX_ZOOM
        const shouldPopulateThemeSource = detailBangumiId != null
        const shouldBuildPointImages = detailBangumiId != null && currentZoom >= focusedImageBuildZoom
        const shouldShowPointImages = shouldBuildPointImages && currentZoom >= focusedImageShowZoom

        if (!shouldPopulateThemeSource) {
          clearThemeSource()
        } else {
          const themeFeatures = fc.features.filter((feature: any) => {
            const props = feature.properties as { bangumiId?: unknown } | undefined
            const bangumiId = Number.parseInt(String(props?.bangumiId ?? ''), 10)
            return Number.isFinite(bangumiId) && bangumiId === detailBangumiId
          })
          updateCompleteModeThemeSource(map, {
            type: 'FeatureCollection',
            features: themeFeatures,
          })
        }

        updateCompleteModeLayerVisibility(map, {
          showCovers: shouldShowCovers,
          showThemeIcons: shouldShowThemeIcons,
          showPointImages: shouldShowPointImages,
        })

        if (currentZoom < COMPLETE_WINDOW_EXCERPT_MIN_ZOOM) {
          clearWindowExcerpt()
        } else {
          const center = map.getCenter()
          const renderedDots = map.getLayer(COMPLETE_DOTS_LAYER_ID)
            ? map.queryRenderedFeatures(undefined, { layers: [COMPLETE_DOTS_LAYER_ID] })
            : []

          const visiblePointKeys = renderedDots.flatMap((hit: any) => {
            const bangumiId = Number.parseInt(String(hit.properties?.bangumiId ?? ''), 10)
            const pointId = String(hit.properties?.pointId ?? '')
            if (!Number.isFinite(bangumiId) || !pointId) return []
            return [{ bangumiId, pointId }]
          })

          const allCards = new Map<number, AnitabiBangumiCard>()
          for (const rows of Object.values(tabCardsRef.current) as Array<AnitabiBangumiCard[] | undefined>) {
            if (!rows) continue
            for (const card of rows) {
              allCards.set(card.id, card)
            }
          }

          const excerpt = computeWindowExcerpt({
            center: [center.lng, center.lat],
            visiblePointKeys,
            warmPointIndexByBangumiId: warmPointIndexByBangumiIdRef.current,
            allCards,
            maxPointItems: COMPLETE_WINDOW_POINT_EXCERPT_MAX,
            maxBangumiItems: COMPLETE_WINDOW_BANGUMI_EXCERPT_MAX,
          })

          setWindowExcerptPoints(excerpt.points)
          setWindowExcerptBangumis(excerpt.bangumis)
        }

        if (!shouldBuildPointImages) {
          completePointImageSyncTokenRef.current += 1
          clearPointImageSource()
          if (detailBangumiId == null) {
            clearThumbImages()
          }
        } else {
          if (!completePointImageLoaderRef.current) {
            completePointImageLoaderRef.current = new ThumbnailLoader({
              map,
              maxLoaded: isDesktopRef.current ? 140 : 80,
              firstViewTrackedLimit: getFirstViewTrackedSlotCount(isDesktopRef.current ? 1440 : 390),
              ...createTrackedMetricCallbacks('point-thumbnail'),
            })
          }

          const featurePool = fc.features.filter((feature: any) => {
            const props = feature.properties as { bangumiId?: unknown } | undefined
            const bangumiId = Number.parseInt(String(props?.bangumiId ?? ''), 10)
            return Number.isFinite(bangumiId) && bangumiId === detailBangumiId
          })

          const pointById = new Map<string, GeoJSON.Feature<GeoJSON.Point>>()
          for (const feature of featurePool) {
            const props = feature.properties as { pointId?: unknown; bangumiId?: unknown } | undefined
            const pointId = String(props?.pointId ?? '')
            if (!pointId) continue
            const bangumiId = Number.parseInt(String(props?.bangumiId ?? ''), 10)
            if (!Number.isFinite(bangumiId)) continue
            pointById.set(`${bangumiId}:${pointId}`, feature as GeoJSON.Feature<GeoJSON.Point>)
          }

          const rendered = map.getLayer(COMPLETE_DOTS_LAYER_ID)
            ? map.queryRenderedFeatures({ layers: [COMPLETE_DOTS_LAYER_ID] })
            : []

          const candidateByPointId = new Map<string, {
            thumbnailKey: string
            pointId: string
            bangumiId: number
            color: string
            imageUrl: string | null
            priority: number
            density: number | null
            geometry: [number, number]
          }>()

          for (const hit of rendered) {
            const hitProps = hit.properties as { pointId?: unknown; bangumiId?: unknown } | undefined
            const rawPointId = String(hitProps?.pointId ?? '')
            const hitBangumiId = Number.parseInt(String(hitProps?.bangumiId ?? ''), 10)
            if (!rawPointId || !Number.isFinite(hitBangumiId)) continue
            if (detailBangumiId != null && hitBangumiId !== detailBangumiId) continue
            const pointKey = `${hitBangumiId}:${rawPointId}`
            if (candidateByPointId.has(pointKey)) continue
            const sourceFeature = pointById.get(pointKey)
            if (!sourceFeature) continue
            const props = sourceFeature.properties as {
              pointId?: unknown
              bangumiId?: unknown
              color?: unknown
              imageUrl?: unknown
              priority?: unknown
              density?: unknown
            }
            const imageUrl = typeof props.imageUrl === 'string' ? props.imageUrl : null
            if (!imageUrl) continue
            const priority = typeof props.priority === 'number' && Number.isFinite(props.priority) ? props.priority : 0
            const bangumiId = Number.parseInt(String(props.bangumiId ?? ''), 10)
            if (!Number.isFinite(bangumiId)) continue
            const color = typeof props.color === 'string' ? props.color : '#333'
            const coords = sourceFeature.geometry?.coordinates
            if (!Array.isArray(coords) || coords.length < 2) continue
            const geometry: [number, number] = [Number(coords[0]), Number(coords[1])]
            if (!Number.isFinite(geometry[0]) || !Number.isFinite(geometry[1])) continue
            const density = typeof props.density === 'number' && Number.isFinite(props.density) ? props.density : null
            candidateByPointId.set(pointKey, {
              thumbnailKey: pointKey,
              pointId: rawPointId,
              bangumiId,
              color,
              imageUrl,
              priority,
              density,
              geometry,
            })
          }

          const maxCandidates = isDesktopRef.current ? 120 : 72
          const candidates = Array.from(candidateByPointId.values())
            .sort((a, b) => {
              const priorityDelta = b.priority - a.priority
              if (priorityDelta !== 0) return priorityDelta
              return a.thumbnailKey.localeCompare(b.thumbnailKey)
            })
            .slice(0, maxCandidates)

          if (candidates.length === 0) {
            completePointImageSyncTokenRef.current += 1
            clearPointImageSource()
          } else {
            const loaderInput: GlobalPointFeatureProperties[] = candidates.map((candidate) => ({
              pointId: candidate.thumbnailKey,
              color: candidate.color,
              selected: 0,
              userState: 'none',
              bangumiId: candidate.bangumiId,
              imageUrl: candidate.imageUrl,
              priority: candidate.priority,
              density: candidate.density,
            }))
            const token = completePointImageSyncTokenRef.current + 1
            completePointImageSyncTokenRef.current = token

            void completePointImageLoaderRef.current.updateViewport(loaderInput).then((loadedIds: Set<string>) => {
              if (completePointImageSyncTokenRef.current !== token) return
              const liveMap = mapRef.current
              if (!liveMap || !liveMap.isStyleLoaded()) return

              const imageFeatures: GeoJSON.Feature<GeoJSON.Point>[] = candidates
                .filter((candidate) => loadedIds.has(`thumb-${candidate.thumbnailKey}`))
                .map((candidate) => ({
                  type: 'Feature',
                  geometry: {
                    type: 'Point',
                    coordinates: candidate.geometry,
                  },
                  properties: {
                    pointId: candidate.pointId,
                    bangumiId: candidate.bangumiId,
                    image: `thumb-${candidate.thumbnailKey}`,
                    y: candidate.geometry[1] * -1,
                    priority: candidate.priority,
                    density: candidate.density,
                  },
                }))

              updateCompleteModePointImageSource(liveMap, {
                type: 'FeatureCollection',
                features: imageFeatures,
              })
              updateCompleteModeLayerVisibility(liveMap, {
                showCovers: shouldShowCovers,
                showThemeIcons: shouldShowThemeIcons,
                showPointImages: shouldShowPointImages,
              })
              liveMap.triggerRepaint()
            }).catch(() => null)
          }
        }

        for (const imageId of spriteImageIdsRef.current) {
          if (!map.hasImage(imageId)) {
            break
          }
        }

        map.triggerRepaint()
        return true
      } catch {
        return false
      }
    }

    syncCompleteModeRef.current = flushCompleteMode
  }, [
    completeCoverCandidatesRef,
    completeCoverFeatureCollectionRef,
    completeFeatureCollectionRef,
    completeImageBuildZoom,
    completeImageShowZoom,
    completePointImageLoaderRef,
    completePointImageSyncTokenRef,
    coverAvatarLoaderRef,
    detailRef,
    isDesktopRef,
    loadedCoverIdsRef,
    mapModeRef,
    mapRef,
    setWindowExcerptBangumis,
    setWindowExcerptPoints,
    spriteImageIdsRef,
    syncCompleteModeRef,
    tabCardsRef,
    warmPointIndexByBangumiIdRef,
  ])

  useEffect(() => {
    if (mapMode !== 'complete' || !mapReady) return
    if (!detail?.card.id || !completeFeatureCollectionRef.current) return

    const timer = window.setTimeout(() => {
      syncCompleteModeRef.current()
    }, 0)

    return () => {
      window.clearTimeout(timer)
    }
  }, [
    completeFeatureCollectionRef,
    detail?.card.id,
    mapMode,
    mapReady,
    selectedPointId,
    syncCompleteModeRef,
    warmupTaskProgress.cards.percent,
    warmupTaskProgress.details.percent,
    warmupTaskProgress.map.percent,
  ])

  useEffect(() => {
    mapModeRef.current = mapMode
  }, [mapMode, mapModeRef])

  useEffect(() => {
    if (mapMode === 'simple') {
      completeFeatureCollectionRef.current = null
      completeCoverFeatureCollectionRef.current = null
      completeCoverCandidatesRef.current = []
      loadedCoverIdsRef.current = new Set()
      coverAvatarLoaderRef.current = null
      completeBaseBuildVersionRef.current = -1
      completeSpriteBuildVersionRef.current = -1
      setCompleteModeLoading(false)
      const map = mapRef.current
      if (map && map.isStyleLoaded()) {
        removeCompleteModeLayers(map)
        removeLabelLayer(map)
      }
      return
    }

    const warmupBaseReady = warmupTaskProgress.map.percent >= 100
      && warmupTaskProgress.cards.percent >= 100
    const hasWarmPointData = warmPointIndexByBangumiIdRef.current.size > 0
    if (!warmupBaseReady || !hasWarmPointData) return

    const shouldEnhanceCompleteMode = warmupTaskProgress.details.percent >= 100
    const needsBaseRebuild = !completeFeatureCollectionRef.current
      || completeBaseBuildVersionRef.current !== warmPointDataVersion
    const needsSpriteEnhancement = shouldEnhanceCompleteMode
      && completeSpriteBuildVersionRef.current !== warmPointDataVersion

    if (!needsBaseRebuild && !needsSpriteEnhancement) {
      syncCompleteModeRef.current()
      return
    }

    completeAbortRef.current?.abort()
    const controller = new AbortController()
    completeAbortRef.current = controller

    const run = async () => {
      const map = mapRef.current
      if (!map) return

      const allInputPoints: Array<{
        lat: number
        lng: number
        bangumiId: string
        color: string
        pointId: string
        imageUrl: string | null
        density: number | null
      }> = []
      const bangumiDataList: Array<{
        bangumiId: number
        color: string
        theme: unknown | null
        points: Array<{ id: string; geo: [number, number] }>
      }> = []

      const allCards = new Map<number, AnitabiBangumiCard>()
      for (const rows of Object.values(tabCardsRef.current) as Array<AnitabiBangumiCard[] | undefined>) {
        if (!rows) continue
        for (const card of rows) {
          allCards.set(card.id, card)
        }
      }

      const coverCandidates = Array.from(allCards.values())
        .filter((card) => Boolean(card.cover) && Boolean(card.geo) && isValidGeoPair(card.geo!))
        .sort((a, b) => {
          const pointDelta = (b.pointsLength || 0) - (a.pointsLength || 0)
          if (pointDelta !== 0) return pointDelta
          const imageDelta = (b.imagesLength || 0) - (a.imagesLength || 0)
          if (imageDelta !== 0) return imageDelta
          return (b.sourceModifiedMs || 0) - (a.sourceModifiedMs || 0)
        })
        .slice(0, COMPLETE_MODE_COVER_CANDIDATES_MAX)
        .map((card) => ({
          bangumiId: card.id,
          coverUrl: card.cover as string,
        }))

      const coverFeatures: GeoJSON.Feature[] = []
      for (const item of coverCandidates) {
        const card = allCards.get(item.bangumiId)
        if (!card?.geo || !isValidGeoPair(card.geo)) continue
        const [lat, lng] = card.geo
        coverFeatures.push({
          type: 'Feature',
          properties: {
            bangumiId: item.bangumiId,
          },
          geometry: {
            type: 'Point',
            coordinates: [lng, lat],
          },
        })
      }
      completeCoverCandidatesRef.current = coverCandidates
      completeCoverFeatureCollectionRef.current = {
        type: 'FeatureCollection',
        features: coverFeatures,
      }
      loadedCoverIdsRef.current = new Set()
      if (!coverAvatarLoaderRef.current) {
        coverAvatarLoaderRef.current = new CoverAvatarLoader({
          map,
          maxLoaded: COMPLETE_MODE_COVER_MAX_LOADED,
          firstViewTrackedLimit: getFirstViewTrackedSlotCount(isDesktopRef.current ? 1440 : 390),
          ...createTrackedMetricCallbacks('cover-avatar'),
        })
      }

      for (const [bangumiId, chunk] of warmPointIndexByBangumiIdRef.current.entries()) {
        if (controller.signal.aborted) return
        const card = allCards.get(bangumiId)
        const color = card?.color || '#333'

        const validPoints: Array<{ id: string; geo: [number, number] }> = []
        for (const point of chunk.points) {
          if (!point.geo || !isValidGeoPair(point.geo)) continue
          validPoints.push({ id: point.id, geo: point.geo })
          allInputPoints.push({
            lat: point.geo[0],
            lng: point.geo[1],
            bangumiId: String(bangumiId),
            color,
            pointId: point.id,
            imageUrl: point.image ?? null,
            density: point.density ?? null,
          })
        }

        if (validPoints.length > 0) {
          bangumiDataList.push({
            bangumiId,
            color,
            theme: chunk.theme,
            points: validPoints,
          })
        }
      }

      if (controller.signal.aborted) return
      if (allInputPoints.length === 0) return

      const fc = createGlobalFeatureCollection(allInputPoints)
      completeFeatureCollectionRef.current = fc
      completeBaseBuildVersionRef.current = warmPointDataVersion
      syncCompleteModeRef.current()
      if (controller.signal.aborted) return

      if (coverAvatarLoaderRef.current && coverCandidates.length > 0) {
        void coverAvatarLoaderRef.current.updateViewport(coverCandidates).then((ids: Set<string>) => {
          if (controller.signal.aborted) return
          loadedCoverIdsRef.current = ids
          const liveMap = mapRef.current
          const coverFc = completeCoverFeatureCollectionRef.current
          if (!liveMap || !liveMap.isStyleLoaded() || !coverFc) return
          updateCompleteModeCoverSource(liveMap, coverFc, ids)
          liveMap.triggerRepaint()
        }).catch(() => null)
      }

      const labelPoints: Array<{ lng: number; lat: number; text: string }> = []
      for (const [bangumiId] of warmPointIndexByBangumiIdRef.current.entries()) {
        const card = allCards.get(bangumiId)
        if (!card) continue
        const chunk = warmPointIndexByBangumiIdRef.current.get(bangumiId)
        if (!chunk) continue
        const firstValid = chunk.points.find((p: any) => p.geo && isValidGeoPair(p.geo))
        if (firstValid?.geo) {
          labelPoints.push({
            lng: firstValid.geo[1],
            lat: firstValid.geo[0],
            text: card.titleZh || card.title,
          })
        }
      }

      if (controller.signal.aborted) return
      if (labelPoints.length > 0 && map.isStyleLoaded()) {
        ensureLabelLayer(map)
        updateLabelSource(map, buildLabelFeatureCollection(labelPoints))
      }

      if (!shouldEnhanceCompleteMode) {
        completeSpriteBuildVersionRef.current = -1
        return
      }

      const imageLoader = (url: string) => {
        return new Promise<HTMLImageElement>((resolve, reject) => {
          if (controller.signal.aborted) {
            reject(new Error('Aborted'))
            return
          }
          const img = new Image()
          img.crossOrigin = 'anonymous'
          img.onload = () => resolve(img)
          img.onerror = () => reject(new Error(`Failed to load: ${url}`))
          const absoluteUrl = url.startsWith('/') ? `https://www.anitabi.cn${url}` : url
          img.src = toCanvasSafeImageUrl(absoluteUrl)

          controller.signal.addEventListener('abort', () => {
            img.src = ''
            reject(new Error('Aborted'))
          }, { once: true })
        })
      }

      const newSpriteIds = new Set<string>()
      const spriteCandidates = bangumiDataList
        .filter((bangumi) => isValidTheme(bangumi.theme))
        .sort((a, b) => b.points.length - a.points.length)
        .slice(0, COMPLETE_MODE_SPRITE_MAX_BANGUMI)
      const spriteDeadline = performance.now() + COMPLETE_MODE_SPRITE_BUDGET_MS
      warmupMetricRef.current.complete_sprite_cut_total = spriteCandidates.length
      warmupMetricRef.current.complete_sprite_cut_done = 0
      warmupMetricRef.current.complete_sprite_cut_budget_hit = 0

      for (let idx = 0; idx < spriteCandidates.length; idx += 1) {
        const bangumi = spriteCandidates[idx]!
        if (controller.signal.aborted) return

        if (performance.now() > spriteDeadline) {
          warmupMetricRef.current.complete_sprite_cut_budget_hit = 1
          break
        }

        try {
          const sprites = await cutSpriteSheet(
            bangumi.bangumiId,
            bangumi.theme as AnitabiTheme,
            bangumi.points.map((p) => ({ id: p.id })),
            bangumi.color,
            imageLoader,
          )
          if (controller.signal.aborted) return

          for (const [imageId, sprite] of sprites.entries()) {
            if (controller.signal.aborted) return
            if (!map.hasImage(imageId)) {
              map.addImage(imageId, sprite.imageData, { pixelRatio: 2 })
            }
            newSpriteIds.add(imageId)
          }

          for (const feature of fc.features) {
            const spriteKey = `sprite-${bangumi.bangumiId}-${feature.properties.pointId}`
            if (sprites.has(spriteKey)) {
              feature.properties.icon = spriteKey
            }
          }
        } catch {
          // Sprite loading failed for this bangumi; feature falls back to dots.
        }
        warmupMetricRef.current.complete_sprite_cut_done = idx + 1
        if ((idx + 1) % 2 === 0) {
          await yieldToMainThread(controller.signal)
        }
      }

      if (controller.signal.aborted) return

      spriteImageIdsRef.current = newSpriteIds
      syncCompleteModeRef.current()
      completeSpriteBuildVersionRef.current = warmPointDataVersion
    }

    setCompleteModeLoading(needsSpriteEnhancement)
    run().catch(() => {
      // Complete mode enhancement is best-effort.
    }).finally(() => {
      setCompleteModeLoading(false)
    })

    return () => {
      controller.abort()
    }
  }, [
    completeAbortRef,
    completeBaseBuildVersionRef,
    completeCoverCandidatesRef,
    completeCoverFeatureCollectionRef,
    completeFeatureCollectionRef,
    completeSpriteBuildVersionRef,
    coverAvatarLoaderRef,
    detail,
    loadedCoverIdsRef,
    mapMode,
    mapRef,
    setCompleteModeLoading,
    spriteImageIdsRef,
    syncCompleteModeRef,
    tabCardsRef,
    warmPointDataVersion,
    warmPointIndexByBangumiIdRef,
    warmupMetricRef,
    warmupTaskProgress.cards.percent,
    warmupTaskProgress.details.percent,
    warmupTaskProgress.map.percent,
  ])

  useEffect(() => () => {
    completeAbortRef.current?.abort()
    completeAbortRef.current = null

    const map = mapRef.current
    if (map && map.isStyleLoaded()) {
      const thumbImageIds = map.listImages().filter((id: string) => id.startsWith('thumb-'))
      for (const imageId of thumbImageIds) {
        if (map.hasImage(imageId)) {
          map.removeImage(imageId)
        }
      }
      for (const imageId of spriteImageIdsRef.current) {
        if (map.hasImage(imageId)) {
          map.removeImage(imageId)
        }
      }
      removeCompleteModeLayers(map)
      removeLabelLayer(map)
    }
    spriteImageIdsRef.current.clear()
    completeFeatureCollectionRef.current = null
    coverAvatarLoaderRef.current = null
    completePointImageLoaderRef.current = null
    completePointImageSyncTokenRef.current += 1
    loadedCoverIdsRef.current = new Set()
    completeCoverFeatureCollectionRef.current = null
    completeCoverCandidatesRef.current = []
    setCompleteModeLoading(false)
  }, [
    completeAbortRef,
    completeCoverCandidatesRef,
    completeCoverFeatureCollectionRef,
    completeFeatureCollectionRef,
    completePointImageLoaderRef,
    completePointImageSyncTokenRef,
    coverAvatarLoaderRef,
    loadedCoverIdsRef,
    mapRef,
    setCompleteModeLoading,
    spriteImageIdsRef,
  ])
}
