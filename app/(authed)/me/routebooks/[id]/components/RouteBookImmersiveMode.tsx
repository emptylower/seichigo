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
  onClose: () => void
}

type UserLocation = { lat: number; lng: number } | null

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

function buildGoogleNavigationUrl(to: [number, number] | null): string | null {
  if (!to) return null
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${to[0]},${to[1]}`)}&travelmode=walking`
}

export function RouteBookImmersiveMode({
  routeBookTitle,
  sorted,
  checkedInPointIds,
  getPointPreview,
  onCheckInSuccess,
  onClose,
}: Props) {
  const [step, setStep] = useState<'intro' | 'cards' | 'summary'>('intro')
  const [currentIndex, setCurrentIndex] = useState(0)
  const [navigatingByPointId, setNavigatingByPointId] = useState<Record<string, boolean>>({})
  const [checkInTargetPointId, setCheckInTargetPointId] = useState<string | null>(null)
  const [isExiting, setIsExiting] = useState(false)
  const [userLocation, setUserLocation] = useState<UserLocation>(null)

  const remainingPoints = useMemo(() => {
    return sorted.filter((point) => !checkedInPointIds.has(point.pointId))
  }, [checkedInPointIds, sorted])

  const totalPoints = sorted.length
  const checkedCount = totalPoints - remainingPoints.length
  const currentPoint = remainingPoints[currentIndex] || null
  const currentPreview = currentPoint ? getPointPreview(currentPoint.pointId) : null
  const currentGeo = currentPreview?.geo || null
  const currentDistance = getDistanceMeters(userLocation, currentGeo)
  const currentNavigationUrl = buildEmbeddedNavigationUrl(currentGeo, userLocation)

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

  if (isExiting) {
    return <div className="fixed inset-0 z-[120] bg-black/80 backdrop-blur-sm transition-opacity duration-300 animate-out fade-out" />
  }

  return (
    <div className="fixed inset-0 z-[120] flex flex-col overflow-hidden bg-slate-950 text-slate-50 animate-in fade-in duration-500">
      <div className="relative z-10 flex items-center justify-between px-6 py-4">
        <div>
          <h2 className="line-clamp-1 text-sm font-bold tracking-tight">{routeBookTitle}</h2>
          <p className="text-[10px] text-slate-400 font-medium tracking-widest uppercase">Immersive Pilgrimage</p>
        </div>
        <button
          type="button"
          onClick={handleClose}
          className="p-2 rounded-full bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-colors border border-white/10"
        >
          <X size={20} />
        </button>
      </div>

      <div className="relative flex-1 flex flex-col items-center p-6 pb-12">
        {step === 'intro' ? (
          <div className="flex h-full w-full max-w-sm flex-col items-center justify-center text-center">
            <h1 className="text-3xl font-black tracking-tight">开始巡礼</h1>
            <p className="mt-3 text-sm leading-relaxed text-slate-400">
              将按你当前的路线排序逐点导航与打卡。
            </p>
            <div className="mt-7 flex gap-6 text-xs text-slate-500">
              <div className="flex items-center gap-1.5"><MapPin size={12} />{totalPoints} 个点位</div>
              <div className="flex items-center gap-1.5"><CheckCircle2 size={12} />已打卡 {checkedCount}</div>
            </div>
            <button
              type="button"
              onClick={() => (remainingPoints.length > 0 ? setStep('cards') : setStep('summary'))}
              className="mt-8 inline-flex items-center gap-2 rounded-full bg-brand-500 px-9 py-4 font-bold text-white shadow-[0_0_40px_rgba(236,72,153,0.3)] transition hover:scale-105 hover:bg-brand-600 active:scale-95"
            >
              进入导航
              <ChevronRight size={18} />
            </button>
          </div>
        ) : null}

        {step === 'cards' && currentPoint && currentPreview ? (
          <div className="flex h-full w-full max-w-5xl flex-col">
            <div className="mb-4 flex items-end justify-between px-1">
              <div className="space-y-1">
                <span className="inline-block rounded-md border border-brand-500/20 bg-brand-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-brand-400">
                  Point
                </span>
                <h3 className="line-clamp-1 text-xl font-bold">{currentPreview.title}</h3>
                <p className="line-clamp-1 text-xs text-slate-400">{currentPreview.subtitle}</p>
              </div>
              <div className="text-right">
                <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Progress</div>
                <div className="text-sm font-mono font-bold text-slate-300">{currentIndex + 1} / {remainingPoints.length}</div>
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
                      <div className="text-slate-400">外部导航</div>
                      {buildGoogleNavigationUrl(currentGeo) ? (
                        <a
                          href={buildGoogleNavigationUrl(currentGeo) || '#'}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-1 inline-flex items-center gap-1 text-white no-underline hover:text-brand-300"
                        >
                          <Navigation size={12} />
                          Google Maps
                        </a>
                      ) : (
                        <div className="mt-1 text-slate-500">不可用</div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="mt-4 grid w-full grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setCheckInTargetPointId(currentPoint.pointId)}
                    className="flex items-center justify-center gap-2 rounded-2xl bg-emerald-500 py-3.5 font-bold text-white hover:bg-emerald-600 active:scale-95"
                  >
                    <CheckCircle2 size={18} />
                    导航完成并打卡
                  </button>
                  <button
                    type="button"
                    onClick={() => setNavigatingByPointId((prev) => ({ ...prev, [currentPoint.pointId]: false }))}
                    className="flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-slate-900 py-3.5 font-bold text-white hover:bg-slate-800 active:scale-95"
                  >
                    <X size={18} />
                    退出导航
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="group relative w-full max-w-md aspect-video overflow-hidden rounded-3xl bg-slate-900 shadow-2xl ring-1 ring-white/10">
                  {currentPreview.image ? (
                    <img
                      src={resolveAnitabiAssetUrl(currentPreview.image) || ''}
                      alt={currentPreview.title}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-slate-500">暂无参考图</div>
                  )}
                </div>

                <div className="mt-5 w-full max-w-md grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setNavigatingByPointId((prev) => ({ ...prev, [currentPoint.pointId]: true }))}
                    className="flex items-center justify-center gap-2 rounded-2xl bg-brand-500 py-3.5 font-bold text-white hover:bg-brand-600 active:scale-95"
                  >
                    <Navigation size={18} />
                    导航
                  </button>
                  <button
                    type="button"
                    onClick={handleSkip}
                    className="flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-slate-900 py-3.5 font-bold text-white hover:bg-slate-800 active:scale-95"
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
            <h2 className="text-3xl font-black tracking-tight">巡礼暂告一段落</h2>
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
              className="mt-8 rounded-full bg-white px-10 py-4 font-bold text-slate-950 transition hover:scale-105 active:scale-95"
            >
              返回地图
            </button>
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
