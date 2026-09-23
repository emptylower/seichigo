'use client'

import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, ChevronRight, MapPin, Navigation, SkipForward, X } from 'lucide-react'
import AttributionLink, { resolveAnitabiAttributionHref } from '@/components/anitabi/AttributionLink'
import CheckInModal from '@/components/checkin/CheckInModal'
import { resolveAnitabiAssetUrl } from '@/lib/anitabi/utils'
import { NavModeToggle } from '@/components/navigation/NavModeToggle'
import { EMBED_API_KEY, resolveEmbedNavUrl, travelModeLabel } from '@/lib/route/embedNavigation'
import type { GoogleMapsTravelMode } from '@/lib/route/google'
import type { SupportedLocale } from '@/lib/i18n/types'
import type { ItemRecord, PlaceRecord, PointPreview } from '../types'
import { tr } from '../../i18n'

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
  locale?: SupportedLocale
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
  locale = 'zh',
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
  // 已经过的站（打卡成功 / 到达 · 下一站 / 跳过）：从剩余站剔除，避免 place 站（无打卡）被 clamp 回来卡住
  const [passedIds, setPassedIds] = useState<Set<string>>(() => new Set())

  const stops = useMemo<StopView[]>(() => {
    return sequence.map((item) => {
      if (item.kind === 'place') {
        const place = places.find((row) => row.id === item.placeId)
        return {
          item,
          title: place?.title ?? item.title ?? tr('routebook.common.placeFallback', locale),
          subtitle: place?.address ?? tr('routebook.immersive.customPlaceLabel', locale),
          image: null,
          geo: place ? [place.lat, place.lng] : null,
          checkInPointId: null,
        }
      }
      const preview = item.pointId ? getPointPreview(item.pointId) : null
      return {
        item,
        title: preview?.title ?? item.title ?? tr('routebook.common.pointFallback', locale),
        subtitle: preview?.subtitle ?? '',
        image: preview?.image ?? null,
        geo: preview?.geo ?? null,
        checkInPointId: item.pointId,
      }
    })
  }, [getPointPreview, places, sequence, locale])

  const remainingStops = useMemo(() => {
    return stops.filter(
      (stop) =>
        !passedIds.has(stop.item.id) && !(stop.checkInPointId && checkedInPointIds.has(stop.checkInPointId))
    )
  }, [checkedInPointIds, passedIds, stops])

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
  // 最后一站是自定义点（无打卡）时也要有明确的「完成今天」出口
  const isLastRemaining = remainingStops.length > 0 && currentIndex >= remainingStops.length - 1
  const isFinalPlaceStop = Boolean(currentStop && currentStop.item.kind === 'place' && isLastRemaining)

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
    // 越过最后一个剩余站 = 今天走完，不再 clamp 回前面的站
    if (currentIndex >= remainingStops.length) {
      setStep('summary')
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

  const markPassed = (itemId: string) => {
    setPassedIds((prev) => {
      if (prev.has(itemId)) return prev
      const next = new Set(prev)
      next.add(itemId)
      return next
    })
  }

  // 到达 · 下一站 / 跳过：当前站记为已过；剔除后同一 currentIndex 即下一站，剔空后 effect 进 summary
  const handleSkip = () => {
    if (!currentStop) {
      setStep('summary')
      return
    }
    markPassed(currentStop.item.id)
  }

  const handleUndoCheckIn = async () => {
    if (!lastCheckedPointId || undoState === 'pending') return
    setUndoState('pending')
    const ok = await onUndoCheckIn(lastCheckedPointId)
    if (!ok) {
      setUndoState('error')
      return
    }
    // 撤销打卡：该站重新回到剩余站
    const restoredIds = stops.filter((stop) => stop.checkInPointId === lastCheckedPointId).map((stop) => stop.item.id)
    setPassedIds((prev) => {
      const next = new Set(prev)
      for (const id of restoredIds) next.delete(id)
      return next
    })
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
            <h1 className="select-none text-3xl font-black tracking-tight text-white">{tr('routebook.immersive.startDay', locale, { day: dayLabel })}</h1>
            <p className="mt-3 text-sm leading-relaxed text-slate-400">
              {tr('routebook.immersive.introBody', locale)}
            </p>
            <div className="mt-7 flex gap-6 text-xs text-slate-400">
              <div className="flex items-center gap-1.5"><MapPin size={12} />{tr('routebook.immersive.totalStops', locale, { n: totalStops })}</div>
              <div className="flex items-center gap-1.5"><CheckCircle2 size={12} />{tr('routebook.immersive.checkedInCount', locale, { n: checkedCount })}</div>
            </div>
            <div className="mt-4 text-xs text-slate-500">{tr('routebook.immersive.remainingStops', locale, { n: remainingStops.length })}</div>
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
                    {firstStop
                      ? tr('routebook.immersive.noReferenceImage', locale, { title: firstStop.title })
                      : tr('routebook.detail.emptyDayToast', locale)}
                  </div>
                )}
              </div>
              <div className="border-t border-white/10 px-4 py-3 text-left">
                <div className="text-[10px] font-semibold uppercase tracking-[0.28em] text-brand-300">First Stop</div>
                <div className="mt-2 line-clamp-1 text-sm font-semibold text-white">{firstStop?.title || tr('routebook.immersive.prepareStart', locale)}</div>
                <div className="mt-1 line-clamp-1 text-xs text-slate-400">{firstStop?.subtitle || tr('routebook.immersive.enterFromFirst', locale)}</div>
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
              {tr('routebook.immersive.enterNav', locale)}
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
                <div className="mt-1 text-[11px] text-slate-500">{tr('routebook.immersive.remainingChecked', locale, { remaining: remainingStops.length, checked: checkedCount })}</div>
              </div>
            </div>

            {navigatingById[currentStop.item.id] ? (
              <>
                <NavModeToggle value={travelMode} onChange={setTravelMode} className="mb-3 self-start" />

                <div className="relative min-h-0 flex-1 overflow-hidden rounded-3xl border border-white/10 bg-slate-900/70 shadow-2xl">
                  {currentNavigationUrl ? (
                    <iframe
                      title={tr('routebook.immersive.navFrameTitle', locale)}
                      src={currentNavigationUrl}
                      className="h-full w-full border-0 bg-slate-900"
                      loading="lazy"
                      referrerPolicy="no-referrer-when-downgrade"
                      allowFullScreen
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center px-5 text-center text-sm text-slate-400">
                      {EMBED_API_KEY
                        ? tr('routebook.immersive.missingCoords', locale)
                        : tr('routebook.immersive.missingApiKey', locale)}
                    </div>
                  )}
                </div>

                <div className="mt-4 rounded-2xl border border-white/10 bg-slate-900/60 px-4 py-3">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{tr('routebook.immersive.onSiteNav', locale)}</div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-300">
                    <div className="rounded-lg bg-slate-800/70 px-3 py-2">
                      <div className="text-slate-400">{tr('routebook.immersive.distance', locale)}</div>
                      <div className="mt-1 font-semibold text-white">{formatDistance(currentDistance)}</div>
                    </div>
                    <div className="rounded-lg bg-slate-800/70 px-3 py-2">
                      <div className="text-slate-400">{tr('routebook.immersive.mode', locale)}</div>
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
                      {tr('routebook.immersive.navDoneCheckIn', locale)}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleSkip}
                      className="flex items-center justify-center gap-2 rounded-2xl bg-emerald-500 py-3.5 font-bold text-white hover:bg-emerald-600 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/60"
                    >
                      <CheckCircle2 size={18} />
                      {tr('routebook.immersive.arrived', locale)}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setNavigatingById((prev) => ({ ...prev, [currentStop.item.id]: false }))}
                    className="flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-slate-900 py-3.5 font-bold text-white hover:bg-slate-800 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
                  >
                    <X size={18} />
                    {tr('routebook.immersive.exitNav', locale)}
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
                      {currentStop.item.kind === 'place'
                        ? tr('routebook.immersive.customPlace', locale, { title: currentStop.title })
                        : tr('routebook.immersive.noImage', locale)}
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
                    {tr('routebook.immersive.navigate', locale)}
                  </button>
                  <button
                    type="button"
                    onClick={handleSkip}
                    className={`flex items-center justify-center gap-2 rounded-2xl py-3.5 font-bold active:scale-95 focus-visible:outline-none ${
                      isFinalPlaceStop
                        ? 'bg-emerald-500 text-white hover:bg-emerald-600 focus-visible:ring-2 focus-visible:ring-emerald-300/60'
                        : 'border border-white/10 bg-slate-900 text-white hover:bg-slate-800 focus-visible:ring-2 focus-visible:ring-white/20'
                    }`}
                  >
                    {isFinalPlaceStop ? <CheckCircle2 size={18} /> : <SkipForward size={18} />}
                    {isFinalPlaceStop ? tr('routebook.immersive.finishToday', locale) : tr('routebook.immersive.skip', locale)}
                  </button>
                </div>
              </>
            )}
          </div>
        ) : null}

        {step === 'summary' ? (
          <div className="flex h-full w-full max-w-md flex-col items-center justify-center text-center">
            <h2 className="select-none text-3xl font-black tracking-tight text-white">{tr('routebook.immersive.dayDone', locale, { day: dayLabel })}</h2>
            <p className="mt-3 text-sm text-slate-400">
              {nextDayFirstTitle
                ? tr('routebook.immersive.tomorrowStart', locale, { title: nextDayFirstTitle })
                : tr('routebook.immersive.allDone', locale)}
            </p>
            <div className="mt-7 grid w-full grid-cols-2 gap-4 rounded-3xl border border-white/10 bg-slate-900/70 p-6">
              <div>
                <div className="text-3xl font-black">{checkedCount}</div>
                <div className="mt-1 text-[11px] text-slate-500">{tr('routebook.immersive.checkedLabel', locale)}</div>
              </div>
              <div>
                <div className="text-3xl font-black text-brand-400">{totalStops}</div>
                <div className="mt-1 text-[11px] text-slate-500">{tr('routebook.immersive.totalLabel', locale)}</div>
              </div>
            </div>
            <button
              type="button"
              onClick={handleClose}
              className="mt-8 rounded-full bg-white px-10 py-4 font-bold text-slate-950 transition hover:scale-105 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
            >
              {tr('routebook.immersive.backToTrip', locale)}
            </button>
          </div>
        ) : null}

        {lastCheckedPointId ? (
          <div className="pointer-events-auto absolute inset-x-6 bottom-6 z-20 mx-auto flex w-full max-w-md items-center justify-between gap-4 rounded-2xl border border-emerald-400/20 bg-slate-900/92 px-4 py-3 shadow-[0_24px_48px_-30px_rgba(15,23,42,0.72)] backdrop-blur-sm">
            <div className="min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-emerald-300">Checked In</div>
              <div className="mt-1 line-clamp-1 text-sm font-semibold text-white">{lastCheckedPreview?.title || lastCheckedPointId}</div>
              <div className="mt-1 text-xs text-slate-400">{tr('routebook.immersive.undoHint', locale)}</div>
            </div>
            <button
              type="button"
              onClick={() => void handleUndoCheckIn()}
              className="shrink-0 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300/60 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={undoState === 'pending'}
            >
              {undoState === 'pending' ? tr('routebook.immersive.undoing', locale) : tr('routebook.immersive.undoCheckIn', locale)}
            </button>
          </div>
        ) : null}

        {undoState === 'error' ? (
          <div className="pointer-events-none absolute bottom-24 left-1/2 z-20 -translate-x-1/2 rounded-xl border border-rose-400/20 bg-rose-500/10 px-4 py-2 text-xs font-medium text-rose-200 backdrop-blur-sm">
            {tr('routebook.immersive.undoFailed', locale)}
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
          submitLabel={tr('routebook.immersive.checkInNext', locale)}
          onSuccess={() => {
            const checkedPointId = checkInTargetPointId
            onCheckInSuccess(checkedPointId)
            setLastCheckedPointId(checkedPointId)
            setUndoState('idle')
            setCheckInTargetPointId(null)
            if (currentStop?.checkInPointId === checkedPointId) {
              markPassed(currentStop.item.id)
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
