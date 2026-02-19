'use client'

import { useState } from 'react'
import { Rocket, Loader2 } from 'lucide-react'
import * as Dialog from '@radix-ui/react-dialog'
import QuickPilgrimageMode from '@/components/quickPilgrimage/QuickPilgrimageMode'
import CheckInCard from '@/components/share/CheckInCard'
import { resolveAnitabiAssetUrl } from '@/lib/anitabi/utils'
import type { AnitabiBangumiDTO, AnitabiPointDTO } from '@/lib/anitabi/types'

interface Props {
  bangumiId: number | null
}

export default function AnimeQuickPilgrimageButton({ bangumiId }: Props) {
  const [isOpen, setIsOpen] = useState(false)
  const [bangumi, setBangumi] = useState<AnitabiBangumiDTO | null>(null)
  const [userPointStates, setUserPointStates] = useState<Record<string, string>>({})
  const [isLoading, setIsLoading] = useState(false)
  
  // Check-in card state
  const [showCheckInCard, setShowCheckInCard] = useState(false)
  const [selectedPoint, setSelectedPoint] = useState<AnitabiPointDTO | null>(null)

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
        if (statesRes?.states) {
          statesRes.states.forEach((s: any) => {
            statesMap[s.pointId] = s.state
          })
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

  const handleCheckIn = (pointId: string) => {
    const point = bangumi?.points.find(p => p.id === pointId)
    if (point) {
      setSelectedPoint(point)
      setShowCheckInCard(true)
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
          onCheckIn={handleCheckIn}
        />
      )}

      {/* Check-in Modal */}
      <Dialog.Root open={showCheckInCard} onOpenChange={setShowCheckInCard}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-sm animate-in fade-in duration-300" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-[201] w-full max-w-md -translate-x-1/2 -translate-y-1/2 p-4 animate-in zoom-in-95 fade-in duration-300 focus:outline-none">
            {selectedPoint && (
              <CheckInCard
                animeTitle={bangumi?.card.title || ''}
                pointName={selectedPoint.nameZh || selectedPoint.name}
                cityName={bangumi?.card.city || ''}
                imageUrl={resolveAnitabiAssetUrl(selectedPoint.image) || ''}
                shareUrl={typeof window !== 'undefined' ? `${window.location.origin}/anime/${bangumiId}?p=${selectedPoint.id}` : ''}
                onClose={() => setShowCheckInCard(false)}
              />
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  )
}
