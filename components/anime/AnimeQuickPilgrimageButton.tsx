'use client'

import { useState } from 'react'
import { Rocket, Loader2 } from 'lucide-react'
import QuickPilgrimageMode from '@/components/quickPilgrimage/QuickPilgrimageMode'
import type { AnitabiBangumiDTO } from '@/lib/anitabi/types'

interface Props {
  bangumiId: number | null
}

export default function AnimeQuickPilgrimageButton({ bangumiId }: Props) {
  const [isOpen, setIsOpen] = useState(false)
  const [bangumi, setBangumi] = useState<AnitabiBangumiDTO | null>(null)
  const [userPointStates, setUserPointStates] = useState<Record<string, string>>({})
  const [isLoading, setIsLoading] = useState(false)

  if (!bangumiId) return null

  const handleOpen = async () => {
    setIsLoading(true)
    try {
      const locale = 'zh'
      const [bangumiRes, statesRes] = await Promise.all([
        fetch(`/api/anitabi/bangumi/${bangumiId}?locale=${locale}`).then(r => r.json()),
        fetch('/api/me/point-states').then(r => r.json()).catch(() => ({ states: [] }))
      ])

      if (bangumiRes && !bangumiRes.error) {
        setBangumi(bangumiRes)
        const statesMap: Record<string, string> = {}
        const stateItems = Array.isArray(statesRes?.items)
          ? statesRes.items
          : Array.isArray(statesRes?.states)
            ? statesRes.states
            : []
        for (const row of stateItems) {
          if (!row || typeof row !== 'object') continue
          const pointId = typeof (row as { pointId?: unknown }).pointId === 'string' ? (row as { pointId: string }).pointId : ''
          const state = typeof (row as { state?: unknown }).state === 'string' ? (row as { state: string }).state : ''
          if (!pointId || !state) continue
          statesMap[pointId] = state
        }
        setUserPointStates(statesMap)
        setIsOpen(true)
      }
    } catch (err) {
      console.error('Failed to load pilgrimage data', err)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <>
      <button
        onClick={handleOpen}
        disabled={isLoading}
        className="flex items-center gap-2 rounded-full bg-brand-500 px-6 py-2.5 text-sm font-bold text-white shadow-lg shadow-brand-500/20 transition-all hover:bg-brand-600 hover:scale-105 active:scale-95 disabled:opacity-50"
      >
        {isLoading ? (
          <Loader2 size={18} className="animate-spin" />
        ) : (
          <Rocket size={18} />
        )}
        {isLoading ? '加载中...' : '快速巡礼'}
      </button>

      {isOpen && bangumi && (
        <QuickPilgrimageMode
          bangumi={bangumi}
          userPointStates={userPointStates}
          onClose={() => setIsOpen(false)}
          onStatesUpdated={async () => {
            const statesRes = await fetch('/api/me/point-states').then((r) => r.json()).catch(() => ({ items: [] }))
            const stateItems = Array.isArray(statesRes?.items) ? statesRes.items : []
            const statesMap: Record<string, string> = {}
            for (const row of stateItems) {
              if (!row || typeof row !== 'object') continue
              const pointId = typeof (row as { pointId?: unknown }).pointId === 'string' ? (row as { pointId: string }).pointId : ''
              const state = typeof (row as { state?: unknown }).state === 'string' ? (row as { state: string }).state : ''
              if (!pointId || !state) continue
              statesMap[pointId] = state
            }
            setUserPointStates(statesMap)
          }}
        />
      )}
    </>
  )
}
