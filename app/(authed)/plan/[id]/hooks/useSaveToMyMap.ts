'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { PlanTextFn } from '../lib/planText'

export type SaveToMyMapState = 'idle' | 'saving' | 'saved'

export type RouteBookExportCounts = {
  days: number
  points: number
  places: number
  notes: number
  transits: number
  lodgings: number
  degradedToNote: number
}

/**
 * /plan 保存到我的地图：created=true（新导入）直接带 ?imported= 计数跳进行程本；
 * created=false（已导过）保持「已保存 · 查看地图」两段式。
 */
export function useSaveToMyMap(planId: string, tx: PlanTextFn) {
  const router = useRouter()
  const [saveState, setSaveState] = useState<SaveToMyMapState>('idle')
  const [savedRouteBookId, setSavedRouteBookId] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  async function handleSave() {
    if (saveState === 'saving') return
    if (saveState === 'saved' && savedRouteBookId) {
      router.push(`/me/routebooks/${savedRouteBookId}`)
      return
    }
    setSaveState('saving')
    setSaveError(null)
    try {
      const res = await fetch(`/api/me/plans/${planId}/export-routebook`, { method: 'POST' })
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; routeBookId?: string; created?: boolean; counts?: RouteBookExportCounts; error?: string }
        | null
      if (res.ok && data?.ok && typeof data.routeBookId === 'string') {
        if (data.created === true) {
          const query = data.counts ? `?imported=${encodeURIComponent(JSON.stringify(data.counts))}` : ''
          router.push(`/me/routebooks/${data.routeBookId}${query}`)
          return
        }
        setSavedRouteBookId(data.routeBookId)
        setSaveState('saved')
      } else {
        setSaveState('idle')
        setSaveError(data?.error ?? tx('day.saveFailed'))
      }
    } catch {
      setSaveState('idle')
      setSaveError(tx('day.networkError'))
    }
  }

  return { saveState, saveError, handleSave }
}
