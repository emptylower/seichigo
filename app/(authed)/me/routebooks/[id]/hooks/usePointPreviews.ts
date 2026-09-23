'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { BangumiResponse, PointPreview } from '../types'
import { PREVIEW_FETCH_IDLE_TIMEOUT, PREVIEW_POINT_BATCH_SIZE } from '../types'
import { buildFallbackPreview, buildPointLookupCandidates, isGeoPair, parseBangumiId, parsePointKey } from '../utils'

/** 点位预览缓存：分批（28 个/批）+ requestIdleCallback 空闲拉取 bangumi 数据 */
export function usePointPreviews(allPointIds: string[]) {
  const [pointPreviewById, setPointPreviewById] = useState<Record<string, PointPreview>>({})

  const resetPreviews = useCallback(() => {
    setPointPreviewById({})
  }, [])

  const unresolvedPointIds = useMemo(
    () => allPointIds.filter((pointId) => !pointPreviewById[pointId]),
    [allPointIds, pointPreviewById]
  )
  const previewFetchPointIds = useMemo(
    () => unresolvedPointIds.slice(0, PREVIEW_POINT_BATCH_SIZE),
    [unresolvedPointIds]
  )

  useEffect(() => {
    if (!previewFetchPointIds.length) return

    const grouped = new Map<number, string[]>()
    const fallbackPreviews: Record<string, PointPreview> = {}

    for (const pointId of previewFetchPointIds) {
      const bangumiId = parseBangumiId(pointId)
      if (!bangumiId) {
        fallbackPreviews[pointId] = buildFallbackPreview(pointId)
        continue
      }
      const list = grouped.get(bangumiId) ?? []
      list.push(pointId)
      grouped.set(bangumiId, list)
    }

    if (Object.keys(fallbackPreviews).length > 0) {
      setPointPreviewById((prev) => ({ ...prev, ...fallbackPreviews }))
    }

    if (!grouped.size) return

    let cancelled = false
    let timeoutId: number | null = null
    let idleId: number | null = null
    const win = window as Window & {
      requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number
      cancelIdleCallback?: (handle: number) => void
    }

    const run = async () => {
      const loadedPreviews: Record<string, PointPreview> = {}

      await Promise.all(
        Array.from(grouped.entries()).map(async ([bangumiId, ids]) => {
          try {
            const res = await fetch(`/api/anitabi/bangumi/${bangumiId}`)
            if (!res.ok) return
            const data = (await res.json().catch(() => null)) as BangumiResponse | null
            if (!data) return

            const pointMap = new Map<string, { title: string; image: string | null; geo: [number, number] | null }>()
            for (const point of data.points || []) {
              const rawPointId = String(point?.id || '').trim()
              if (!rawPointId) continue
              const title = (point.nameZh || point.name || rawPointId || '').trim()
              if (!title) continue
              const meta = {
                title,
                image: typeof point.image === 'string' ? point.image : null,
                geo: isGeoPair(point.geo) ? ([point.geo[0], point.geo[1]] as [number, number]) : null,
              }
              for (const candidate of buildPointLookupCandidates(rawPointId)) {
                pointMap.set(candidate, meta)
              }
            }

            const subtitle =
              (typeof data.card?.titleZh === 'string' && data.card.titleZh.trim()) ||
              (typeof data.card?.title === 'string' && data.card.title.trim()) ||
              `作品 #${bangumiId}`

            for (const pointId of ids) {
              const matched = buildPointLookupCandidates(pointId)
                .map((candidate) => pointMap.get(candidate))
                .find((entry) => Boolean(entry))
              const key = parsePointKey(pointId)
              loadedPreviews[pointId] = {
                title: matched?.title || `点位 ${key}`,
                subtitle,
                image: matched?.image || null,
                geo: matched?.geo || null,
              }
            }
          } catch {
            for (const pointId of ids) {
              loadedPreviews[pointId] = buildFallbackPreview(pointId)
            }
          }
        })
      )

      if (cancelled) return

      setPointPreviewById((prev) => {
        const next = { ...prev }
        for (const pointId of previewFetchPointIds) {
          next[pointId] = loadedPreviews[pointId] || next[pointId] || buildFallbackPreview(pointId)
        }
        return next
      })
    }

    if (typeof win.requestIdleCallback === 'function' && typeof win.cancelIdleCallback === 'function') {
      idleId = win.requestIdleCallback(() => {
        void run()
      }, { timeout: PREVIEW_FETCH_IDLE_TIMEOUT })
    } else {
      timeoutId = window.setTimeout(() => {
        void run()
      }, 180)
    }

    return () => {
      cancelled = true
      if (timeoutId !== null) window.clearTimeout(timeoutId)
      if (idleId !== null && typeof win.cancelIdleCallback === 'function') {
        win.cancelIdleCallback(idleId)
      }
    }
  }, [previewFetchPointIds])

  const getPointPreview = useCallback(
    (pointId: string) => pointPreviewById[pointId] || buildFallbackPreview(pointId),
    [pointPreviewById]
  )

  return { getPointPreview, resetPreviews }
}
