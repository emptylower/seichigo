'use client'

import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, ChevronRight, MapPin, Navigation, SkipForward, X } from 'lucide-react'
import CheckInModal from '@/components/checkin/CheckInModal'
import { resolveAnitabiAssetUrl } from '@/lib/anitabi/utils'
import type { PointPreview, PointRecord } from '../types'

type Props = {
  routeBookTitle: string
  sorted: PointRecord[]
  checkedInPointIds: Set<string>
  getPointPreview: (pointId: string) => PointPreview | null
  onCheckInSuccess: (pointId: string) => void
  onUndoCheckIn: (pointId: string) => Promise<boolean>
  onClose: () => void
}

type UserLocation = { lat: number; lng: number } | null
type UndoState = 'idle' | 'pending' | 'error'

function getDistanceMeters(from: UserLocation, to: [number, number] | null): number | null {
  if (!from || !to) return null
  const [toLat, toLng] = to
  const rad = Math.PI / 180
  const dLat = (toLat - from.lat) * rad
  const dLng = (toLng - from.lng) * rad
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(from.lat * rad) * Math.cos(toLat * rad) * Math.sin(dLng / 2) * Math.sin(dLng / 2)
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function formatDistance(distance: number | null): string {
  if (distance == null || !Number.isFinite(distance)) return '--'
  if (distance >= 1000) return `${(distance / 1000).toFixed(1)} km`
  return `${Math.round(distance)} m`
}

function buildEmbeddedNavigationUrl(to: [number, number] | null, userLocation: UserLocation): string {
  const params = new URLSearchParams()
  params.set('output', 'embed')
  params.set('dirflg', 'w')

  if (to) {
    params.set('daddr', `${to[0]},${to[1]}`)
  }

  if (userLocation) {
    params.set('saddr', `${userLocation.lat},${userLocation.lng}`)
  }

  return `https://www.google.com/maps?${params.toString()}`
}

export function RouteBookImmersiveMode({
  routeBookTitle,
  sorted,
  checkedInPointIds,
  getPointPreview,
  onCheckInSuccess,
  onUndoCheckIn,
  onClose,
}: Props) {
  const [step, setStep] = useState<'intro' | 'cards' | 'summary'>('intro')
  const [currentIndex, setCurrentIndex] = useState(0)
  const [navigatingByPointId, setNavigatingByPointId] = useState<Record<string, boolean>>({})
  const [checkInTargetPointId, setCheckInTargetPointId] = useState<string | null>(null)
  const [lastCheckedPointId, setLastCheckedPointId] = useState<string | null>(null)
  const [pendingRestorePointId, setPendingRestorePointId] = useState<string | null>(null)
  const [undoState, setUndoState] = useState<UndoState>('idle')
  const [isExiting, setIsExiting] = useState(false)
  const [userLocation, setUserLocation] = useState<UserLocation>(null)

  const remainingPoints = useMemo(() => {
    return sorted.filter((point) => !checkedInPointIds.has(point.pointId))
  }, [checkedInPointIds, sorted])

  const totalPoints = sorted.length
  const checkedCount = totalPoints - remainingPoints.length
  const currentPoint = remainingPoints[currentIndex] || null
  const currentPreview = currentPoint ? getPointPreview(currentPoint.pointId) : null
  const firstPreview = sorted[0] ? getPointPreview(sorted[0].pointId) : null
  const currentGeo = currentPreview?.geo || null
  const currentDistance = getDistanceMeters(userLocation, currentGeo)
  const currentNavigationUrl = buildEmbeddedNavigationUrl(currentGeo, userLocation)
  const currentOrdinal = currentPoint ? Math.max(1, sorted.findIndex((point) => point.pointId === currentPoint.pointId) + 1) : checkedCount
  const lastCheckedPreview = lastCheckedPointId ? getPointPreview(lastCheckedPointId) : null

  useEffect(() => {
    if (!('geolocation' in navigator)) return
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setUserLocation({ lat: position.coords.latitude, lng: position.coords.longitude })
      },
      () => undefined,
      { enableHighAccuracy: true, timeout: 6000 }
    )
  }, [])

  useEffect(() => {
    if (step !== 'cards') return
    if (remainingPoints.length === 0) {
      setStep('summary')
      return
    }
    if (currentIndex >= remainingPoints.length) {
      setCurrentIndex(remainingPoints.length - 1)
    }
  }, [currentIndex, remainingPoints.length, step])

  useEffect(() => {
    if (!pendingRestorePointId) return
    const restoredIndex = remainingPoints.findIndex((point) => point.pointId === pendingRestorePointId)
    if (restoredIndex < 0) return
    setStep('cards')
    setCurrentIndex(restoredIndex)
    setPendingRestorePointId(null)
  }, [pendingRestorePointId, remainingPoints])

  const handleClose = () => {
    setIsExiting(true)
    window.setTimeout(onClose, 240)
  }

  const handleSkip = () => {
    if (currentIndex < remainingPoints.length - 1) {
      setCurrentIndex((prev) => prev + 1)
      return
    }
    setStep('summary')
  }

  const handleUndoCheckIn = async () => {
    if (!lastCheckedPointId || undoState === 'pending') return
    setUndoState('pending')
    const ok = await onUndoCheckIn(lastCheckedPointId)
    if (!ok) {
      setUndoState('error')
      return
    }
    setPendingRestorePointId(lastCheckedPointId)
    setLastCheckedPointId(null)
    setUndoState('idle')
  }

  if (isExiting) {
    return <div className="fixed inset-0 z-[120] bg-black/80 backdrop-blur-sm transition-opacity duration-300 animate-out fade-out" />
  }

  return (
    <div className="fixed inset-0 z-[120] flex flex-col overflow-hidden bg-slate-950 text-slate-50 animate-in fade-in duration-500 selection:bg-brand-500/30 selection:text-white">
      <div className="relative z-10 flex select-none items-center justify-between px-6 py-4">
        <div>
          <h2 className="line-clamp-1 text-sm font-bold tracking-tight text-white">{routeBookTitle}</h2>
          <p className="text-[10px] text-slate-400 font-medium tracking-widest uppercase">Immersive Pilgrimage</p>
        </div>
        <button
          type="button"
          onClick={handleClose}
          className="rounded-full border border-white/10 bg-white/5 p-2 text-slate-400 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400/60"
        >
          <X size={20} />
        </button>
      </div>

      <div className="relative flex-1 flex flex-col items-center p-6 pb-12">
        {step === 'intro' ? (
          <div className="flex h-full w-full max-w-md flex-col items-center justify-center text-center">
            <h1 className="select-none text-3xl font-black tracking-tight text-white">开始巡礼</h1>
            <p className="mt-3 text-sm leading-relaxed text-slate-400">
              将按你当前的路线排序逐点导航与打卡。
            </p>
            <div className="mt-7 flex gap-6 text-xs text-slate-400">
              <div className="flex items-center gap-1.5"><MapPin size={12} />总计 {totalPoints} 个点位</div>
              <div className="flex items-center gap-1.5"><CheckCircle2 size={12} />已打卡 {checkedCount}</div>
            </div>
            <div className="mt-4 text-xs text-slate-500">待巡礼 {remainingPoints.length} 个</div>
            <div className="mt-8 w-full max-w-sm overflow-hidden rounded-[28px] border border-white/10 bg-slate-900/70 shadow-[0_24px_50px_-36px_rgba(15,23,42,0.72)]">
              <div className="aspect-[16/9] w-full bg-slate-900">
                {firstPreview?.image ? (
                  <img
                    src={resolveAnitabiAssetUrl(firstPreview.image) || ''}
                    alt={firstPreview.title || routeBookTitle}
                    className="h-full w-full object-cover object-center"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center px-5 text-center text-sm text-slate-500">首个点位暂无参考图</div>
                )}
              </div>
              <div className="border-t border-white/10 px-4 py-3 text-left">
                <div className="text-[10px] font-semibold uppercase tracking-[0.28em] text-brand-300">First Stop</div>
                <div className="mt-2 line-clamp-1 text-sm font-semibold text-white">{firstPreview?.title || '准备开始巡礼'}</div>
                <div className="mt-1 line-clamp-1 text-xs text-slate-400">{firstPreview?.subtitle || '从第一站进入沉浸式导航'}</div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => (remainingPoints.length > 0 ? setStep('cards') : setStep('summary'))}
              className="mt-8 inline-flex items-center gap-2 rounded-full bg-brand-500 px-9 py-4 font-bold text-white shadow-[0_0_40px_rgba(236,72,153,0.3)] transition hover:scale-105 hover:bg-brand-600 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300/70"
            >
              进入导航
              <ChevronRight size={18} />
            </button>
          </div>
        ) : null}

        {step === 'cards' && currentPoint && currentPreview ? (
          <div className="mx-auto flex h-full w-full max-w-5xl flex-col">
            <div className="mb-4 flex select-none items-end justify-between px-1">
              <div className="space-y-1">
                <span className="inline-block rounded-md border border-brand-500/20 bg-brand-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-brand-400">
                  Point
                </span>
                <h3 className="line-clamp-1 text-xl font-bold text-white">{currentPreview.title}</h3>
                <p className="line-clamp-1 text-xs text-slate-400">{currentPreview.subtitle}</p>
              </div>
              <div className="text-right">
                <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Progress</div>
                <div className="text-sm font-mono font-bold text-slate-200">{currentOrdinal} / {totalPoints}</div>
                <div className="mt-1 text-[11px] text-slate-500">剩余 {remainingPoints.length} · 已打卡 {checkedCount}</div>
              </div>
            </div>

            {navigatingByPointId[currentPoint.pointId] ? (
              <>
                <div className="relative min-h-0 flex-1 overflow-hidden rounded-3xl border border-white/10 bg-slate-900/70 shadow-2xl">
                  <iframe
                    title="站内导航画面"
                    src={currentNavigationUrl}
                    className="h-full w-full border-0 bg-slate-900"
                    loading="lazy"
                    referrerPolicy="no-referrer-when-downgrade"
                  />
                </div>

                <div className="mt-4 rounded-2xl border border-white/10 bg-slate-900/60 px-4 py-3">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">站内导航</div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-300">
                    <div className="rounded-lg bg-slate-800/70 px-3 py-2">
                      <div className="text-slate-400">距离</div>
                      <div className="mt-1 font-semibold text-white">{formatDistance(currentDistance)}</div>
                    </div>
                    <div className="rounded-lg bg-slate-800/70 px-3 py-2">
                      <div className="text-slate-400">导航模式</div>
                      <div className="mt-1 text-white">站内地图导航</div>
                    </div>
                  </div>
                </div>

                <div className="mt-4 grid w-full grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setCheckInTargetPointId(currentPoint.pointId)}
                    className="flex items-center justify-center gap-2 rounded-2xl bg-emerald-500 py-3.5 font-bold text-white hover:bg-emerald-600 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/60"
                  >
                    <CheckCircle2 size={18} />
                    导航完成并打卡
                  </button>
                  <button
                    type="button"
                    onClick={() => setNavigatingByPointId((prev) => ({ ...prev, [currentPoint.pointId]: false }))}
                    className="flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-slate-900 py-3.5 font-bold text-white hover:bg-slate-800 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
                  >
                    <X size={18} />
                    退出导航
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="group relative mx-auto w-full max-w-3xl aspect-video overflow-hidden rounded-3xl bg-slate-900 shadow-2xl ring-1 ring-white/10">
                  {currentPreview.image ? (
                    <img
                      src={resolveAnitabiAssetUrl(currentPreview.image) || ''}
                      alt={currentPreview.title}
                      className="h-full w-full object-cover object-center"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-slate-500">暂无参考图</div>
                  )}
                </div>

                <div className="mt-5 mx-auto w-full max-w-3xl grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setNavigatingByPointId((prev) => ({ ...prev, [currentPoint.pointId]: true }))}
                    className="flex items-center justify-center gap-2 rounded-2xl bg-brand-500 py-3.5 font-bold text-white hover:bg-brand-600 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300/70"
                  >
                    <Navigation size={18} />
                    导航
                  </button>
                  <button
                    type="button"
                    onClick={handleSkip}
                    className="flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-slate-900 py-3.5 font-bold text-white hover:bg-slate-800 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
                  >
                    <SkipForward size={18} />
                    跳过
                  </button>
                </div>
              </>
            )}
          </div>
        ) : null}

        {step === 'summary' ? (
          <div className="flex h-full w-full max-w-md flex-col items-center justify-center text-center">
            <h2 className="select-none text-3xl font-black tracking-tight text-white">巡礼暂告一段落</h2>
            <p className="mt-3 text-sm text-slate-400">你已完成当前路线中的可巡礼点位。</p>
            <div className="mt-7 grid w-full grid-cols-2 gap-4 rounded-3xl border border-white/10 bg-slate-900/70 p-6">
              <div>
                <div className="text-3xl font-black">{checkedCount}</div>
                <div className="mt-1 text-[11px] text-slate-500">已打卡</div>
              </div>
              <div>
                <div className="text-3xl font-black text-brand-400">{totalPoints}</div>
                <div className="mt-1 text-[11px] text-slate-500">总点位</div>
              </div>
            </div>
            <button
              type="button"
              onClick={handleClose}
              className="mt-8 rounded-full bg-white px-10 py-4 font-bold text-slate-950 transition hover:scale-105 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
            >
              返回地图
            </button>
          </div>
        ) : null}

        {lastCheckedPointId ? (
          <div className="pointer-events-auto absolute inset-x-6 bottom-6 z-20 mx-auto flex w-full max-w-md items-center justify-between gap-4 rounded-2xl border border-emerald-400/20 bg-slate-900/92 px-4 py-3 shadow-[0_24px_48px_-30px_rgba(15,23,42,0.72)] backdrop-blur-sm">
            <div className="min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-emerald-300">Checked In</div>
              <div className="mt-1 line-clamp-1 text-sm font-semibold text-white">{lastCheckedPreview?.title || lastCheckedPointId}</div>
              <div className="mt-1 text-xs text-slate-400">误操作可以撤销，点位会回到当前导航队列。</div>
            </div>
            <button
              type="button"
              onClick={() => void handleUndoCheckIn()}
              className="shrink-0 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300/60 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={undoState === 'pending'}
            >
              {undoState === 'pending' ? '恢复中…' : '撤销打卡'}
            </button>
          </div>
        ) : null}

        {undoState === 'error' ? (
          <div className="pointer-events-none absolute bottom-24 left-1/2 z-20 -translate-x-1/2 rounded-xl border border-rose-400/20 bg-rose-500/10 px-4 py-2 text-xs font-medium text-rose-200 backdrop-blur-sm">
            撤销失败，请稍后重试。
          </div>
        ) : null}
      </div>

      {checkInTargetPointId ? (
        <CheckInModal
          pointId={checkInTargetPointId}
          pointName={getPointPreview(checkInTargetPointId)?.title || checkInTargetPointId}
          referenceImageUrl={resolveAnitabiAssetUrl(getPointPreview(checkInTargetPointId)?.image || null)}
          pointGeo={(() => {
            const geo = getPointPreview(checkInTargetPointId)?.geo
            if (!geo) return null
            return { lat: geo[0], lng: geo[1] }
          })()}
          submitLabel="打卡并下一站"
          onSuccess={() => {
            const checkedPointId = checkInTargetPointId
            onCheckInSuccess(checkedPointId)
            setLastCheckedPointId(checkedPointId)
            setUndoState('idle')
            setCheckInTargetPointId(null)
            if (currentPoint?.pointId === checkedPointId) {
              setNavigatingByPointId((prev) => {
                const next = { ...prev }
                delete next[checkedPointId]
                return next
              })
            }
          }}
          onClose={() => setCheckInTargetPointId(null)}
        />
      ) : null}
    </div>
  )
}
