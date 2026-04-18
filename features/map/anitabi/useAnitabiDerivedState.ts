import { useMemo } from 'react'
import type { AnitabiBangumiDTO } from '@/lib/anitabi/types'
import {
  isValidGeoPair,
  looksLikeImageUrl,
  matchPointId,
  normalizePointInlineImageUrl,
  normalizePointImageSaveUrl,
  normalizePointImageUrl,
  resolvePanoramaEmbed,
} from './media'
import { distanceMeters, formatDistance } from './geo'

export function useAnitabiDerivedState(ctx: any) {
  const {
    detail,
    selectedPointId,
    detailCardMode,
    meState,
    userLocation,
    viewFilter,
    stateFilter,
  } = ctx

  const selectedPoint = useMemo(() => {
    if (!detail || !selectedPointId) return null
    return detail.points.find((point: any) => matchPointId(point.id, selectedPointId)) || null
  }, [detail, selectedPointId])

  const shouldResetPointMode = detailCardMode === 'point' && !selectedPoint

  const selectedPointState = useMemo(() => {
    if (!selectedPoint || !meState) return null
    return meState.pointStates.find((ps: any) => ps.pointId === selectedPoint.id)?.state || null
  }, [meState, selectedPoint])

  const showWantToGoAction = Boolean(selectedPoint && selectedPointState === null)

  const quickPilgrimageStates = useMemo(() => {
    const out: Record<string, string> = {}
    for (const row of meState?.pointStates || []) {
      out[row.pointId] = row.state
    }
    return out
  }, [meState])

  const quickPilgrimageProgress = useMemo(() => {
    if (!detail) return { checked: 0, total: 0 }
    const checked = detail.points.filter((point: any) => quickPilgrimageStates[point.id] === 'checked_in').length
    return { checked, total: detail.points.length }
  }, [detail, quickPilgrimageStates])

  const detailPoints = useMemo(() => {
    if (!detail) return [] as Array<{ point: AnitabiBangumiDTO['points'][number]; distanceMeters: number | null }>

    const origin = userLocation ? [userLocation.lng, userLocation.lat] as [number, number] : null
    const ranked = detail.points
      .filter((point: any) => {
        const userState = meState?.pointStates.find((ps: any) => ps.pointId === point.id)?.state || 'none'
        if (viewFilter === 'marked' && userState === 'none') return false
        if (stateFilter.length > 0 && !stateFilter.includes(userState)) return false
        return true
      })
      .map((point: any, index: number) => {
        const pointCoord = isValidGeoPair(point.geo) ? [point.geo[1], point.geo[0]] as [number, number] : null
        const pointDistance = origin && pointCoord ? distanceMeters(origin, pointCoord) : null
        return { point, distanceMeters: pointDistance, index }
      })

    ranked.sort((a: any, b: any) => {
      if (a.distanceMeters != null && b.distanceMeters != null) {
        if (a.distanceMeters !== b.distanceMeters) return a.distanceMeters - b.distanceMeters
      } else if (a.distanceMeters != null) {
        return -1
      } else if (b.distanceMeters != null) {
        return 1
      }
      return a.index - b.index
    })

    return ranked.map(({ point, distanceMeters: pointDistance }: any) => ({ point, distanceMeters: pointDistance }))
  }, [detail, meState, stateFilter, userLocation, viewFilter])

  const selectedPointDistanceMeters = useMemo(() => {
    if (!selectedPoint || !userLocation || !isValidGeoPair(selectedPoint.geo)) return null
    return distanceMeters([userLocation.lng, userLocation.lat], [selectedPoint.geo[1], selectedPoint.geo[0]])
  }, [selectedPoint, userLocation])

  const selectedPointPanorama = useMemo(() => {
    if (!selectedPoint) return null
    return resolvePanoramaEmbed(selectedPoint)
  }, [selectedPoint])

  const selectedPointImage = useMemo(() => {
    if (!selectedPoint) {
      return {
        inlineUrl: null as string | null,
        previewUrl: null as string | null,
        downloadUrl: null as string | null,
      }
    }

    const inlineUrl = normalizePointInlineImageUrl(selectedPoint.image)
    const previewUrl = normalizePointImageUrl(selectedPoint.image)
    const originUrl = String(selectedPoint.originUrl || '').trim()
    const downloadUrl = looksLikeImageUrl(originUrl)
      ? normalizePointImageSaveUrl(originUrl)
      : normalizePointImageSaveUrl(selectedPoint.image)

    return { inlineUrl, previewUrl, downloadUrl }
  }, [selectedPoint])

  const routeSummary = useMemo(() => {
    if (!detail || !meState) {
      return { totalRouteDistance: '0 km', checkedInThumbnails: [] as string[] }
    }
    const checkedInPoints = detail.points.filter((p: any) =>
      meState.pointStates.find((ps: any) => ps.pointId === p.id && ps.state === 'checked_in')
    )

    let meters = 0
    for (let i = 0; i < detail.points.length - 1; i += 1) {
      const p1 = detail.points[i]
      const p2 = detail.points[i + 1]
      if (p1?.geo && p2?.geo) {
        meters += distanceMeters([p1.geo[1], p1.geo[0]], [p2.geo[1], p2.geo[0]])
      }
    }

    const thumbnails = checkedInPoints
      .map((p: any) => normalizePointImageUrl(p.image))
      .filter((src: any): src is string => !!src)
      .slice(0, 3)

    return {
      totalRouteDistance: formatDistance(meters),
      checkedInThumbnails: thumbnails,
    }
  }, [detail, meState])

  return {
    detailPoints,
    quickPilgrimageProgress,
    quickPilgrimageStates,
    routeSummary,
    selectedPoint,
    selectedPointDistanceMeters,
    selectedPointImage,
    selectedPointPanorama,
    selectedPointState,
    shouldResetPointMode,
    showWantToGoAction,
  }
}
