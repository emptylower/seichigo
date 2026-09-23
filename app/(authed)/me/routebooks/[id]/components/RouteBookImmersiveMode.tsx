'use client'

import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, ChevronRight, MapPin, Navigation, SkipForward, X } from 'lucide-react'
import AttributionLink, { resolveAnitabiAttributionHref } from '@/components/anitabi/AttributionLink'
import CheckInModal from '@/components/checkin/CheckInModal'
import { resolveAnitabiAssetUrl } from '@/lib/anitabi/utils'
import { NavModeToggle } from '@/components/navigation/NavModeToggle'
import { EMBED_API_KEY, resolveEmbedNavUrl, travelModeLabel } from '@/lib/route/embedNavigation'
import type { GoogleMapsTravelMode } from '@/lib/route/google'
import type { ItemRecord, PlaceRecord, PointPreview } from '../types'

type Props = {
  routeBookTitle: string
  /** 当天 point/place 条目按序（sequenceForImmersive） */
  sequence: ItemRecord[]
  places: PlaceRecord[]
  dayLabel: string
  /** 有下一天时给「明天从 X 开始」 */
  nextDayFirstTitle?: string | null
  checkedInPointIds: Set<string>
  getPointPreview: (pointId: string) => PointPreview | null
  onCheckInSuccess: (pointId: string) => void
  onUndoCheckIn: (pointId: string) => Promise<boolean>
  onClose: () => void
}

type UserLocation = { lat: number; lng: number } | null
type UndoState = 'idle' | 'pending' | 'error'

type StopView = {
  item: ItemRecord
  title: string
  subtitle: string
  image: string | null
  geo: [number, number] | null
  /** 打卡只对 kind=point 可用 */
  checkInPointId: string | null
}

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

export function RouteBookImmersiveMode({
  routeBookTitle,
  sequence,
  places,
  dayLabel,
  nextDayFirstTitle = null,
  checkedInPointIds,
  getPointPreview,
  onCheckInSuccess,
  onUndoCheckIn,
  onClose,
}: Props) {
  const [step, setStep] = useState<'intro' | 'cards' | 'summary'>('intro')
  const [currentIndex, setCurrentIndex] = useState(0)
  const [navigatingById, setNavigatingById] = useState<Record<string, boolean>>({})
  const [checkInTargetPointId, setCheckInTargetPointId] = useState<string | null>(null)
  const [lastCheckedPointId, setLastCheckedPointId] = useState<string | null>(null)
  const [pendingRestorePointId, setPendingRestorePointId] = useState<string | null>(null)
  const [undoState, setUndoState] = useState<UndoState>('idle')
  const [isExiting, setIsExiting] = useState(false)
  const [userLocation, setUserLocation] = useState<UserLocation>(null)
  const [travelMode, setTravelMode] = useState<GoogleMapsTravelMode>('walking')

  const stops = useMemo<StopView[]>(() => {
    return sequence.map((item) => {
      if (item.kind === 'place') {
        const place = places.find((row) => row.id === item.placeId)
        return {
          item,
          title: place?.title ?? item.title ?? '地点',
          subtitle: place?.address ?? '自定义地点',
          image: null,
          geo: place ? [place.lat, place.lng] : null,
          checkInPointId: null,
        }
      }
      const preview = item.pointId ? getPointPreview(item.pointId) : null
      return {
        item,
        title: preview?.title ?? item.title ?? '点位',
        subtitle: preview?.subtitle ?? '',
        image: preview?.image ?? null,
        geo: preview?.geo ?? null,
        checkInPointId: item.pointId,
      }
    })
  }, [getPointPreview, places, sequence])

  const remainingStops = useMemo(() => {
    return stops.filter((stop) => !(stop.checkInPointId && checkedInPointIds.has(stop.checkInPointId)))
  }, [checkedInPointIds, stops])

  const totalStops = stops.length
  const checkedCount = stops.filter((stop) => stop.checkInPointId && checkedInPointIds.has(stop.checkInPointId)).length
  const currentStop = remainingStops[currentIndex] || null
  const firstStop = stops[0] || null
  const currentGeo = currentStop?.geo || null
  const currentDistance = getDistanceMeters(userLocation, currentGeo)
  const currentNavigationUrl = currentGeo
    ? resolveEmbedNavUrl({ lat: currentGeo[0], lng: currentGeo[1] }, userLocation, travelMode)
    : null
  const currentOrdinal = currentStop ? Math.max(1, stops.findIndex((stop) => stop.item.id === currentStop.item.id) + 1) : checkedCount
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
    if (remainingStops.length === 0) {
      setStep('summary')
      return
    }
    if (currentIndex >= remainingStops.length) {
      setCurrentIndex(remainingStops.length - 1)
    }
  }, [currentIndex, remainingStops.length, step])

  useEffect(() => {
    if (!pendingRestorePointId) return
    const restoredIndex = remainingStops.findIndex((stop) => stop.checkInPointId === pendingRestorePointId)
    if (restoredIndex < 0) return
    setStep('cards')
    setCurrentIndex(restoredIndex)
    setPendingRestorePointId(null)
  }, [pendingRestorePointId, remainingStops])

  const handleClose = () => {
    setIsExiting(true)
    window.setTimeout(onClose, 240)
  }

  const handleSkip = () => {
    if (currentIndex < remainingStops.length - 1) {
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
          <p className="text-[10px] text-slate-400 font-medium tracking-widest uppercase">{dayLabel} · Immersive Pilgrimage</p>
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
            <h1 className="select-none text-3xl font-black tracking-tight text-white">开始 {dayLabel}</h1>
            <p className="mt-3 text-sm leading-relaxed text-slate-400">
              将按这一天的顺序逐站导航与打卡。
            </p>
            <div className="mt-7 flex gap-6 text-xs text-slate-400">
              <div className="flex items-center gap-1.5"><MapPin size={12} />总计 {totalStops} 站</div>
              <div className="flex items-center gap-1.5"><CheckCircle2 size={12} />已打卡 {checkedCount}</div>
            </div>
            <div className="mt-4 text-xs text-slate-500">待巡礼 {remainingStops.length} 站</div>
            <div className="mt-8 w-full max-w-sm overflow-hidden rounded-[28px] border border-white/10 bg-slate-900/70 shadow-[0_24px_50px_-36px_rgba(15,23,42,0.72)]">
              <div className="aspect-[16/9] w-full bg-slate-900">
                {firstStop?.image ? (
                  <img
                    src={resolveAnitabiAssetUrl(firstStop.image) || ''}
                    alt={firstStop.title || routeBookTitle}
                    className="h-full w-full object-cover object-center"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center px-5 text-center text-sm text-slate-500">
                    {firstStop ? `${firstStop.title} 暂无参考图` : '这一天还没有站点'}
                  </div>
                )}
              </div>
              <div className="border-t border-white/10 px-4 py-3 text-left">
                <div className="text-[10px] font-semibold uppercase tracking-[0.28em] text-brand-300">First Stop</div>
                <div className="mt-2 line-clamp-1 text-sm font-semibold text-white">{firstStop?.title || '准备开始巡礼'}</div>
                <div className="mt-1 line-clamp-1 text-xs text-slate-400">{firstStop?.subtitle || '从第一站进入沉浸式导航'}</div>
                {firstStop?.image ? (
                  <div className="mt-2">
                    <AttributionLink
                      href={resolveAnitabiAttributionHref(firstStop.image)}
                      className="text-xs text-slate-400 hover:text-white"
                    />
                  </div>
                ) : null}
              </div>
            </div>
            <button
              type="button"
              onClick={() => (remainingStops.length > 0 ? setStep('cards') : setStep('summary'))}
              className="mt-8 inline-flex items-center gap-2 rounded-full bg-brand-500 px-9 py-4 font-bold text-white shadow-[0_0_40px_rgba(236,72,153,0.3)] transition hover:scale-105 hover:bg-brand-600 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300/70"
            >
              进入导航
              <ChevronRight size={18} />
            </button>
          </div>
        ) : null}

        {step === 'cards' && currentStop ? (
          <div className="mx-auto flex h-full w-full max-w-5xl flex-col">
            <div className="mb-4 flex select-none items-end justify-between px-1">
              <div className="space-y-1">
                <span className="inline-block rounded-md border border-brand-500/20 bg-brand-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-brand-400">
                  {currentStop.item.kind === 'place' ? 'Place' : 'Point'}
                </span>
                <h3 className="line-clamp-1 text-xl font-bold text-white">{currentStop.title}</h3>
                <p className="line-clamp-1 text-xs text-slate-400">{currentStop.subtitle}</p>
              </div>
              <div className="text-right">
                <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Progress</div>
                <div className="text-sm font-mono font-bold text-slate-200">{currentOrdinal} / {totalStops}</div>
                <div className="mt-1 text-[11px] text-slate-500">剩余 {remainingStops.length} · 已打卡 {checkedCount}</div>
              </div>
            </div>

            {navigatingById[currentStop.item.id] ? (
              <>
                <NavModeToggle value={travelMode} onChange={setTravelMode} className="mb-3 self-start" />

                <div className="relative min-h-0 flex-1 overflow-hidden rounded-3xl border border-white/10 bg-slate-900/70 shadow-2xl">
                  {currentNavigationUrl ? (
                    <iframe
                      title="站内导航画面"
                      src={currentNavigationUrl}
                      className="h-full w-full border-0 bg-slate-900"
                      loading="lazy"
                      referrerPolicy="no-referrer-when-downgrade"
                      allowFullScreen
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center px-5 text-center text-sm text-slate-400">
                      {EMBED_API_KEY
                        ? '当前站点缺少坐标，无法生成导航预览。'
                        : '未配置 NEXT_PUBLIC_GOOGLE_MAPS_API_KEY，导航预览不可用。'}
                    </div>
                  )}
                </div>

                <div className="mt-4 rounded-2xl border border-white/10 bg-slate-900/60 px-4 py-3">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">站内导航</div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-300">
                    <div className="rounded-lg bg-slate-800/70 px-3 py-2">
                      <div className="text-slate-400">距离</div>
                      <div className="mt-1 font-semibold text-white">{formatDistance(currentDistance)}</div>
                    </div>
                    <div className="rounded-lg bg-slate-800/70 px-3 py-2">
                      <div className="text-slate-400">出行方式</div>
                      <div className="mt-1 text-white">{travelModeLabel(travelMode)}</div>
                    </div>
                  </div>
                </div>

                <div className="mt-4 grid w-full grid-cols-2 gap-3">
                  {currentStop.checkInPointId ? (
                    <button
                      type="button"
                      onClick={() => setCheckInTargetPointId(currentStop.checkInPointId)}
                      className="flex items-center justify-center gap-2 rounded-2xl bg-emerald-500 py-3.5 font-bold text-white hover:bg-emerald-600 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/60"
                    >
                      <CheckCircle2 size={18} />
                      导航完成并打卡
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleSkip}
                      className="flex items-center justify-center gap-2 rounded-2xl bg-emerald-500 py-3.5 font-bold text-white hover:bg-emerald-600 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/60"
                    >
                      <CheckCircle2 size={18} />
                      已到这一站
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setNavigatingById((prev) => ({ ...prev, [currentStop.item.id]: false }))}
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
                  {currentStop.image ? (
                    <img
                      src={resolveAnitabiAssetUrl(currentStop.image) || ''}
                      alt={currentStop.title}
                      className="h-full w-full object-cover object-center"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center px-6 text-center text-slate-500">
                      {currentStop.item.kind === 'place' ? `自定义地点 · ${currentStop.title}` : '暂无参考图'}
                    </div>
                  )}
                </div>
                {currentStop.image ? (
                  <div className="mt-3 mx-auto w-full max-w-3xl">
                    <AttributionLink
                      href={resolveAnitabiAttributionHref(currentStop.image)}
                      className="text-xs text-slate-400 hover:text-white"
                    />
                  </div>
                ) : null}

                <div className="mt-5 mx-auto w-full max-w-3xl grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setNavigatingById((prev) => ({ ...prev, [currentStop.item.id]: true }))}
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
            <h2 className="select-none text-3xl font-black tracking-tight text-white">{dayLabel} 完成</h2>
            <p className="mt-3 text-sm text-slate-400">
              {nextDayFirstTitle ? `明天从 ${nextDayFirstTitle} 开始` : '你已完成这一天可巡礼的站点。'}
            </p>
            <div className="mt-7 grid w-full grid-cols-2 gap-4 rounded-3xl border border-white/10 bg-slate-900/70 p-6">
              <div>
                <div className="text-3xl font-black">{checkedCount}</div>
                <div className="mt-1 text-[11px] text-slate-500">已打卡</div>
              </div>
              <div>
                <div className="text-3xl font-black text-brand-400">{totalStops}</div>
                <div className="mt-1 text-[11px] text-slate-500">总站点</div>
              </div>
            </div>
            <button
              type="button"
              onClick={handleClose}
              className="mt-8 rounded-full bg-white px-10 py-4 font-bold text-slate-950 transition hover:scale-105 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
            >
              返回行程
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
          attributionHref={resolveAnitabiAttributionHref(getPointPreview(checkInTargetPointId)?.image || null)}
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
            if (currentStop?.checkInPointId === checkedPointId) {
              setNavigatingById((prev) => {
                const next = { ...prev }
                delete next[currentStop.item.id]
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
