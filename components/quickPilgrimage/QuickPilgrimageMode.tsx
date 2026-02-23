'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { X, Navigation, SkipForward, CheckCircle2, MapPin, Film, ChevronRight, Award, Map as MapIcon, RotateCcw } from 'lucide-react'
import type { AnitabiBangumiDTO, AnitabiPointDTO } from '@/lib/anitabi/types'
import { getHaversineDistance, resolveAnitabiAssetUrl } from '@/lib/anitabi/utils'
import CheckInModal from '@/components/checkin/CheckInModal'
import RouteBookCard from '@/components/share/RouteBookCard'
import SessionShareFab from '@/components/quickPilgrimage/SessionShareFab'

type Props = {
  bangumi: AnitabiBangumiDTO
  userPointStates: Record<string, string>
  onClose: () => void
  onStatesUpdated?: () => void
}

function toDirectionLabel(bearing: number): string {
  if (bearing >= 337.5 || bearing < 22.5) return '北'
  if (bearing < 67.5) return '东北'
  if (bearing < 112.5) return '东'
  if (bearing < 157.5) return '东南'
  if (bearing < 202.5) return '南'
  if (bearing < 247.5) return '西南'
  if (bearing < 292.5) return '西'
  return '西北'
}

function calcBearing(fromLat: number, fromLng: number, toLat: number, toLng: number): number {
  const rad = Math.PI / 180
  const phi1 = fromLat * rad
  const phi2 = toLat * rad
  const dLambda = (toLng - fromLng) * rad

  const y = Math.sin(dLambda) * Math.cos(phi2)
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda)

  const theta = Math.atan2(y, x)
  return ((theta * 180) / Math.PI + 360) % 360
}

function formatDistanceMeters(distance: number | null): string {
  if (distance == null || !Number.isFinite(distance)) return '--'
  if (distance >= 1000) return `${(distance / 1000).toFixed(1)} km`
  return `${Math.round(distance)} m`
}

function isLikelyMobileDevice(): boolean {
  if (typeof navigator === 'undefined') return false
  return /android|iphone|ipad|ipod/i.test(navigator.userAgent)
}

function buildGoogleMapsAppUrl(point: AnitabiPointDTO): string {
  const destination = point.geo ? `${point.geo[0]},${point.geo[1]}` : point.name
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent.toLowerCase()
  if (ua.includes('android')) {
    return `google.navigation:q=${encodeURIComponent(destination)}&mode=w`
  }
  return `comgooglemaps://?daddr=${encodeURIComponent(destination)}&directionsmode=walking`
}

function buildEmbeddedNavigationUrl(
  point: AnitabiPointDTO,
  userLocation: { lat: number; lng: number } | null
): string {
  const destination = point.geo ? `${point.geo[0]},${point.geo[1]}` : point.name
  const params = new URLSearchParams()
  params.set('output', 'embed')
  params.set('dirflg', 'w')
  params.set('daddr', destination)
  if (userLocation) {
    params.set('saddr', `${userLocation.lat},${userLocation.lng}`)
  }
  return `https://www.google.com/maps?${params.toString()}`
}

export default function QuickPilgrimageMode({ bangumi, userPointStates, onClose, onStatesUpdated }: Props) {
  const [step, setStep] = useState<'intro' | 'cards' | 'summary'>('intro')
  const [currentIndex, setCurrentIndex] = useState(0)
  const [navigationStepByPointId, setNavigationStepByPointId] = useState<Record<string, 'idle' | 'navigating' | 'done'>>({})
  const [embeddedNavigationByPointId, setEmbeddedNavigationByPointId] = useState<Record<string, boolean>>({})
  const [navigationNotice, setNavigationNotice] = useState<string | null>(null)
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null)
  const [isExiting, setIsExiting] = useState(false)
  const [checkInTargetId, setCheckInTargetId] = useState<string | null>(null)
  const [showSessionShareCard, setShowSessionShareCard] = useState(false)
  const [sessionCheckedPointIds, setSessionCheckedPointIds] = useState<string[]>([])
  const [comparisonImageByPointId, setComparisonImageByPointId] = useState<Record<string, string>>({})
  const [checkedInPointIds, setCheckedInPointIds] = useState<Set<string>>(() => {
    const seed = new Set<string>()
    for (const point of bangumi.points) {
      if (userPointStates[point.id] === 'checked_in') seed.add(point.id)
    }
    return seed
  })
  const comparisonUrlsRef = useRef<string[]>([])
  const navigationFallbackTimerRef = useRef<number | null>(null)
  const navigationVisibilityListenerRef = useRef<((this: Document, ev: Event) => void) | null>(null)

  useEffect(() => {
    setCheckedInPointIds((prev) => {
      const next = new Set(prev)
      for (const point of bangumi.points) {
        if (userPointStates[point.id] === 'checked_in') {
          next.add(point.id)
        }
      }
      return next
    })
  }, [bangumi.points, userPointStates])

  useEffect(() => {
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude })
        },
        () => {
          // noop
        },
        { enableHighAccuracy: true, timeout: 5000 }
      )
    }
  }, [])

  useEffect(() => {
    comparisonUrlsRef.current = Object.values(comparisonImageByPointId)
  }, [comparisonImageByPointId])

  useEffect(() => {
    return () => {
      for (const url of comparisonUrlsRef.current) {
        if (!url) continue
        window.URL.revokeObjectURL(url)
      }
    }
  }, [])

  const clearNavigationDetection = () => {
    if (navigationFallbackTimerRef.current != null) {
      window.clearTimeout(navigationFallbackTimerRef.current)
      navigationFallbackTimerRef.current = null
    }
    if (navigationVisibilityListenerRef.current) {
      document.removeEventListener('visibilitychange', navigationVisibilityListenerRef.current)
      navigationVisibilityListenerRef.current = null
    }
  }

  useEffect(() => {
    return () => {
      clearNavigationDetection()
    }
  }, [])

  const points = useMemo(() => {
    const remaining = bangumi.points.filter((point) => !checkedInPointIds.has(point.id))

    if (userLocation) {
      remaining.sort((a, b) => {
        if (!a.geo && !b.geo) return a.id.localeCompare(b.id)
        if (!a.geo) return 1
        if (!b.geo) return -1

        const da = getHaversineDistance(userLocation.lat, userLocation.lng, a.geo[0], a.geo[1])
        const db = getHaversineDistance(userLocation.lat, userLocation.lng, b.geo[0], b.geo[1])
        if (da !== db) return da - db
        return a.id.localeCompare(b.id)
      })
      return remaining
    }

    remaining.sort((a, b) => {
      const epA = Number.parseInt(a.ep || '0', 10) || 999
      const epB = Number.parseInt(b.ep || '0', 10) || 999
      if (epA !== epB) return epA - epB
      return a.id.localeCompare(b.id)
    })

    return remaining
  }, [bangumi.points, checkedInPointIds, userLocation])

  useEffect(() => {
    if (step !== 'cards') return

    if (points.length === 0) {
      setStep('summary')
      return
    }

    if (currentIndex >= points.length) {
      setCurrentIndex(points.length - 1)
    }
  }, [currentIndex, points.length, step])

  const totalPoints = bangumi.points.length
  const checkedInCount = totalPoints - points.length
  const currentPoint = points[currentIndex] || null
  const currentNavigationStep = currentPoint ? navigationStepByPointId[currentPoint.id] || 'idle' : 'idle'
  const currentEmbeddedNavigationVisible = currentPoint ? embeddedNavigationByPointId[currentPoint.id] !== false : true
  const checkInTarget = checkInTargetId ? bangumi.points.find((point) => point.id === checkInTargetId) || null : null

  const currentDistance = useMemo(() => {
    if (!currentPoint?.geo || !userLocation) return null
    return getHaversineDistance(userLocation.lat, userLocation.lng, currentPoint.geo[0], currentPoint.geo[1])
  }, [currentPoint, userLocation])

  const currentDirection = useMemo(() => {
    if (!currentPoint?.geo || !userLocation) return null
    const bearing = calcBearing(userLocation.lat, userLocation.lng, currentPoint.geo[0], currentPoint.geo[1])
    return `${toDirectionLabel(bearing)} ${Math.round(bearing)}°`
  }, [currentPoint, userLocation])

  const currentEmbeddedNavigationUrl = useMemo(() => {
    if (!currentPoint) return ''
    return buildEmbeddedNavigationUrl(currentPoint, userLocation)
  }, [currentPoint, userLocation])

  useEffect(() => {
    setNavigationNotice(null)
  }, [currentPoint?.id])

  const sessionCheckedPoints = useMemo(
    () => sessionCheckedPointIds
      .map((pointId) => bangumi.points.find((point) => point.id === pointId) || null)
      .filter((point): point is AnitabiPointDTO => Boolean(point)),
    [bangumi.points, sessionCheckedPointIds]
  )

  const sessionTotalDistance = useMemo(() => {
    if (sessionCheckedPoints.length <= 1) return '0 km'
    let meters = 0
    for (let i = 0; i < sessionCheckedPoints.length - 1; i++) {
      const from = sessionCheckedPoints[i]
      const to = sessionCheckedPoints[i + 1]
      if (!from?.geo || !to?.geo) continue
      meters += getHaversineDistance(from.geo[0], from.geo[1], to.geo[0], to.geo[1])
    }
    if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km`
    return `${Math.round(meters)} m`
  }, [sessionCheckedPoints])

  const featuredSessionImages = useMemo(
    () => sessionCheckedPoints
      .map((point) => comparisonImageByPointId[point.id] || resolveAnitabiAssetUrl(point.image) || null)
      .filter((row): row is string => Boolean(row))
      .slice(0, 3),
    [comparisonImageByPointId, sessionCheckedPoints]
  )

  const sessionSharePoints = useMemo(() => {
    const fromSession = sessionCheckedPoints
      .filter((point): point is AnitabiPointDTO & { geo: [number, number] } => Boolean(point.geo))
      .map((point) => ({ lat: point.geo[0], lng: point.geo[1] }))

    if (fromSession.length > 0) return fromSession

    const fallback = bangumi.points.find((point): point is AnitabiPointDTO & { geo: [number, number] } => Boolean(point.geo))
    return fallback ? [{ lat: fallback.geo[0], lng: fallback.geo[1] }] : []
  }, [bangumi.points, sessionCheckedPoints])

  const handleSkip = () => {
    clearNavigationDetection()
    setNavigationNotice(null)
    if (currentIndex < points.length - 1) {
      setCurrentIndex((prev) => prev + 1)
      return
    }
    setStep('summary')
  }

  const handleStartNavigation = () => {
    if (!currentPoint) return

    setNavigationStepByPointId((prev) => ({ ...prev, [currentPoint.id]: 'navigating' }))
    setEmbeddedNavigationByPointId((prev) => ({ ...prev, [currentPoint.id]: true }))
    setNavigationNotice(null)

    if (!isLikelyMobileDevice()) return

    clearNavigationDetection()

    let wentBackground = false
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        wentBackground = true
      }
    }
    navigationVisibilityListenerRef.current = onVisibilityChange
    document.addEventListener('visibilitychange', onVisibilityChange)

    const appUrl = buildGoogleMapsAppUrl(currentPoint)
    try {
      window.location.assign(appUrl)
    } catch {
      // noop: fallback handled by timer below
    }

    navigationFallbackTimerRef.current = window.setTimeout(() => {
      if (navigationVisibilityListenerRef.current) {
        document.removeEventListener('visibilitychange', navigationVisibilityListenerRef.current)
        navigationVisibilityListenerRef.current = null
      }
      navigationFallbackTimerRef.current = null

      if (wentBackground) {
        setEmbeddedNavigationByPointId((prev) => ({ ...prev, [currentPoint.id]: false }))
        setNavigationNotice('已尝试跳转 Google Maps 导航，返回后可点击“导航完成”或“重新导航”。')
      } else {
        setEmbeddedNavigationByPointId((prev) => ({ ...prev, [currentPoint.id]: true }))
        setNavigationNotice('未检测到 Google Maps App，已切换为站内导航。')
      }
    }, 1200)
  }

  const handleClose = () => {
    setIsExiting(true)
    setTimeout(onClose, 260)
  }

  if (isExiting) {
    return <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm transition-opacity duration-300 animate-out fade-out" />
  }

  return (
    <div className="fixed inset-0 z-[100] flex flex-col overflow-hidden bg-slate-950 text-slate-50 animate-in fade-in duration-500">
      <div className="absolute inset-0 -z-10 overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-brand-500/20 blur-[120px] rounded-full animate-pulse" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-blue-500/10 blur-[120px] rounded-full" />
      </div>

      <div className="relative z-10 flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-brand-500/20 text-brand-400">
            <Film size={18} />
          </div>
          <div>
            <h2 className="text-sm font-bold tracking-tight line-clamp-1">{bangumi.card.title}</h2>
            <p className="text-[10px] text-slate-400 font-medium tracking-widest uppercase">Quick Pilgrimage Mode</p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleClose}
          className="p-2 rounded-full bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-colors border border-white/10"
        >
          <X size={20} />
        </button>
      </div>

      <div
        className={`relative flex-1 flex flex-col items-center p-6 pb-12 ${
          step === 'cards' && currentNavigationStep === 'navigating' ? 'justify-start' : 'justify-center'
        }`}
      >
        {step === 'intro' && (
          <div className="flex flex-col items-center text-center max-w-sm animate-in zoom-in-95 fade-in duration-700">
            <div className="relative mb-8 group">
              <div className="absolute inset-0 bg-brand-500 blur-2xl opacity-20 group-hover:opacity-40 transition-opacity" />
              <div className="relative aspect-[3/4] w-48 overflow-hidden rounded-2xl shadow-2xl ring-1 ring-white/20 transform transition-transform group-hover:scale-105 duration-500">
                <img
                  src={resolveAnitabiAssetUrl(bangumi.card.cover) || ''}
                  alt={bangumi.card.title}
                  className="h-full w-full object-cover"
                />
              </div>
            </div>
            <h1 className="text-3xl font-black mb-3 tracking-tight">开始巡礼</h1>
            <p className="text-slate-400 text-sm mb-10 leading-relaxed px-4">
              使用站内导航逐点推进。你可以随时打开 Google Maps，但不必离开当前流程。
            </p>
            <button
              type="button"
              onClick={() => (points.length > 0 ? setStep('cards') : setStep('summary'))}
              className="group relative flex items-center gap-3 bg-brand-500 hover:bg-brand-600 text-white px-10 py-4 rounded-full font-bold shadow-[0_0_40px_rgba(236,72,153,0.3)] transition-all hover:scale-105 active:scale-95"
            >
              即刻出发
              <ChevronRight size={20} className="group-hover:translate-x-1 transition-transform" />
            </button>
            <div className="mt-8 flex gap-6 text-[11px] font-bold text-slate-500 tracking-wider uppercase">
              <div className="flex items-center gap-1.5">
                <MapPin size={12} className="text-brand-500/60" />
                {totalPoints} 个地点
              </div>
              <div className="flex items-center gap-1.5">
                <CheckCircle2 size={12} className="text-emerald-500/60" />
                已打卡 {checkedInCount}
              </div>
            </div>
          </div>
        )}

        {step === 'cards' && currentPoint && currentNavigationStep === 'navigating' && (
          <div key={`${currentPoint.id}:navigating`} className="flex h-full w-full max-w-5xl flex-col animate-in fade-in duration-300">
            <div className="mb-4 flex items-end justify-between px-1">
              <div className="space-y-1">
                <span className="inline-block rounded-md border border-brand-500/20 bg-brand-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-brand-400">
                  {currentPoint.ep ? `EP. ${currentPoint.ep}` : 'POI'}
                </span>
                <h3 className="line-clamp-1 text-xl font-bold">{currentPoint.nameZh || currentPoint.name}</h3>
              </div>
              <div className="text-right">
                <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Progress</div>
                <div className="text-sm font-mono font-bold text-slate-300">{currentIndex + 1} / {points.length}</div>
              </div>
            </div>

            {navigationNotice ? (
              <div className="mb-3 w-full rounded-lg border border-blue-400/20 bg-blue-500/10 px-3 py-2 text-[11px] text-blue-200">
                {navigationNotice}
              </div>
            ) : null}

            <div className="relative min-h-0 flex-1 overflow-hidden rounded-3xl border border-white/10 bg-slate-900/70 shadow-2xl">
              {currentEmbeddedNavigationVisible ? (
                <iframe
                  title="站内导航画面"
                  src={currentEmbeddedNavigationUrl}
                  className="h-full w-full border-0 bg-slate-900"
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                />
              ) : (
                <div className="flex h-full items-center justify-center px-5 text-center text-sm text-slate-300">
                  已尝试跳转 Google Maps App。返回后可点击“导航完成”，也可点击“切换站内导航”继续在本页面导航。
                </div>
              )}
            </div>

            <div className="mt-4 rounded-2xl border border-white/10 bg-slate-900/60 px-4 py-3">
              <div className="flex items-center justify-between">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">站内导航</div>
                <span className="rounded-full bg-blue-500/20 px-2 py-0.5 text-[10px] font-semibold text-blue-300">导航中</span>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-300">
                <div className="rounded-lg bg-slate-800/70 px-3 py-2">
                  <div className="text-slate-400">方向</div>
                  <div className="mt-1 font-semibold text-white">{currentDirection || '未知'}</div>
                </div>
                <div className="rounded-lg bg-slate-800/70 px-3 py-2">
                  <div className="text-slate-400">距离</div>
                  <div className="mt-1 font-semibold text-white">{formatDistanceMeters(currentDistance)}</div>
                </div>
              </div>
              <div className="mt-2 text-[11px] text-slate-400">
                导航中：可按方向与距离前进。完成后点击“导航完成”或“退出导航”。
              </div>
            </div>

            <div className="mt-4 grid w-full grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => {
                  clearNavigationDetection()
                  setNavigationNotice(null)
                  setNavigationStepByPointId((prev) => ({ ...prev, [currentPoint.id]: 'done' }))
                }}
                className="flex items-center justify-center gap-2 rounded-2xl bg-emerald-500 py-3.5 font-bold text-white hover:bg-emerald-600 active:scale-95"
              >
                <CheckCircle2 size={18} />
                导航完成
              </button>
              <button
                type="button"
                onClick={() => {
                  clearNavigationDetection()
                  setNavigationNotice(null)
                  setNavigationStepByPointId((prev) => ({ ...prev, [currentPoint.id]: 'done' }))
                }}
                className="flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-slate-900 py-3.5 font-bold text-white hover:bg-slate-800 active:scale-95"
              >
                <X size={18} />
                退出导航
              </button>
            </div>

            {!currentEmbeddedNavigationVisible ? (
              <button
                type="button"
                onClick={() => setEmbeddedNavigationByPointId((prev) => ({ ...prev, [currentPoint.id]: true }))}
                className="mt-3 inline-flex items-center justify-center gap-1.5 text-xs text-slate-300 hover:text-white"
              >
                <Navigation size={14} />
                切换站内导航
              </button>
            ) : null}
          </div>
        )}

        {step === 'cards' && currentPoint && currentNavigationStep !== 'navigating' && (
          <div key={`${currentPoint.id}:normal`} className="flex w-full max-w-md flex-col items-center animate-in slide-in-from-right-8 fade-in duration-500">
            <div className="mb-4 flex w-full items-end justify-between px-2">
              <div className="space-y-1">
                <span className="inline-block rounded-md border border-brand-500/20 bg-brand-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-brand-400">
                  {currentPoint.ep ? `EP. ${currentPoint.ep}` : 'POI'}
                </span>
                <h3 className="line-clamp-1 text-xl font-bold">{currentPoint.nameZh || currentPoint.name}</h3>
              </div>
              <div className="text-right">
                <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Progress</div>
                <div className="text-sm font-mono font-bold text-slate-300">{currentIndex + 1} / {points.length}</div>
              </div>
            </div>

            <div className="group relative w-full aspect-video overflow-hidden rounded-3xl bg-slate-900 shadow-2xl ring-1 ring-white/10">
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
              {currentPoint.image ? (
                <img
                  src={resolveAnitabiAssetUrl(currentPoint.image) || ''}
                  alt={currentPoint.name}
                  className="h-full w-full object-cover transition-transform duration-1000 group-hover:scale-105"
                />
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-3 text-slate-600">
                  <Film size={48} strokeWidth={1} />
                  <p className="text-xs font-medium uppercase tracking-widest">No Screenshot</p>
                </div>
              )}
            </div>

            <div className="mt-4 w-full rounded-2xl border border-white/10 bg-slate-900/60 px-4 py-3">
              <div className="flex items-center justify-between">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">站内导航</div>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    currentNavigationStep === 'done'
                      ? 'bg-emerald-500/20 text-emerald-300'
                      : 'bg-slate-700/70 text-slate-300'
                  }`}
                >
                  {currentNavigationStep === 'done' ? '已结束' : '未开始'}
                </span>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-300">
                <div className="rounded-lg bg-slate-800/70 px-3 py-2">
                  <div className="text-slate-400">方向</div>
                  <div className="mt-1 font-semibold text-white">{currentDirection || '未知'}</div>
                </div>
                <div className="rounded-lg bg-slate-800/70 px-3 py-2">
                  <div className="text-slate-400">距离</div>
                  <div className="mt-1 font-semibold text-white">{formatDistanceMeters(currentDistance)}</div>
                </div>
              </div>
              <div className="mt-2 text-[11px] text-slate-400">
                {currentNavigationStep === 'idle'
                  ? '先点击“导航”进入整页导航视图。导航完成或退出后，才可打卡。'
                  : currentPoint.note || '你已结束导航，可以打卡并进入下一站，或重新导航。'}
              </div>
            </div>

            {currentNavigationStep === 'idle' ? (
              <div className="mt-6 grid w-full grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={handleStartNavigation}
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
            ) : null}

            {currentNavigationStep === 'done' ? (
              <>
                <div className="mt-6 grid w-full grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setCheckInTargetId(currentPoint.id)}
                    className="flex items-center justify-center gap-2 rounded-2xl bg-brand-500 py-3.5 font-bold text-white hover:bg-brand-600 active:scale-95"
                  >
                    <CheckCircle2 size={18} />
                    打卡并下一步
                  </button>
                  <button
                    type="button"
                    onClick={handleStartNavigation}
                    className="flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-slate-900 py-3.5 font-bold text-white hover:bg-slate-800 active:scale-95"
                  >
                    <RotateCcw size={18} />
                    重新导航
                  </button>
                </div>
                <button
                  type="button"
                  onClick={handleSkip}
                  className="mt-3 inline-flex items-center gap-1.5 text-xs text-slate-300 hover:text-white"
                >
                  <SkipForward size={14} />
                  跳过此点
                </button>
              </>
            ) : null}
          </div>
        )}

        {step === 'summary' && (
          <div className="flex flex-col items-center text-center max-w-md animate-in zoom-in-95 fade-in duration-700">
            <div className="w-20 h-20 bg-brand-500/20 rounded-full flex items-center justify-center mb-8 ring-4 ring-brand-500/10">
              <Award size={40} className="text-brand-500 animate-bounce" />
            </div>
            <h2 className="text-3xl font-black mb-2 tracking-tight">巡礼暂告一段落</h2>
            <p className="text-slate-400 text-sm mb-12 max-w-[280px]">
              {checkedInCount === totalPoints
                ? '恭喜你！已完成全部地点的巡礼。'
                : '你已经浏览了本次可巡礼地点，可继续探索其他圣地。'}
            </p>

            <div className="w-full bg-slate-900/50 rounded-3xl p-8 border border-white/5 mb-10 grid grid-cols-2 gap-8 relative overflow-hidden">
              <div className="absolute inset-0 bg-brand-500/5 blur-3xl" />
              <div className="relative">
                <div className="text-4xl font-black text-white mb-1">{checkedInCount}</div>
                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">已打卡地点</div>
              </div>
              <div className="relative">
                <div className="text-4xl font-black text-brand-500 mb-1">{totalPoints}</div>
                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">总巡礼点</div>
              </div>
            </div>

            <button
              type="button"
              onClick={handleClose}
              className="flex items-center gap-2 bg-white text-slate-950 px-12 py-4 rounded-full font-bold shadow-xl transition-all hover:scale-105 active:scale-95"
            >
              <MapIcon size={18} />
              返回地图
            </button>
          </div>
        )}
      </div>

      {step === 'cards' && points.length > 0 ? (
        <div className="absolute bottom-0 left-0 w-full h-1 bg-slate-900">
          <div
            className="h-full bg-brand-500 transition-all duration-500 ease-out"
            style={{ width: `${((currentIndex + 1) / points.length) * 100}%` }}
          />
        </div>
      ) : null}

      {sessionCheckedPointIds.length > 0 ? (
        <SessionShareFab count={sessionCheckedPointIds.length} onClick={() => setShowSessionShareCard(true)} />
      ) : null}

      {checkInTarget ? (
        <CheckInModal
          pointId={checkInTarget.id}
          pointName={checkInTarget.nameZh || checkInTarget.name}
          referenceImageUrl={resolveAnitabiAssetUrl(checkInTarget.image)}
          pointGeo={checkInTarget.geo ? { lat: checkInTarget.geo[0], lng: checkInTarget.geo[1] } : null}
          animeTitle={bangumi.card.title}
          episode={checkInTarget.ep}
          submitLabel="打卡并下一步"
          onComparisonGenerated={(blob) => {
            const objectUrl = URL.createObjectURL(blob)
            setComparisonImageByPointId((prev) => {
              const old = prev[checkInTarget.id]
              if (old) URL.revokeObjectURL(old)
              return { ...prev, [checkInTarget.id]: objectUrl }
            })
          }}
          onSuccess={() => {
            const pointId = checkInTarget.id
            clearNavigationDetection()
            setCheckedInPointIds((prev) => {
              const next = new Set(prev)
              next.add(pointId)
              return next
            })
            setNavigationStepByPointId((prev) => {
              if (!(pointId in prev)) return prev
              const next = { ...prev }
              delete next[pointId]
              return next
            })
            setEmbeddedNavigationByPointId((prev) => {
              if (!(pointId in prev)) return prev
              const next = { ...prev }
              delete next[pointId]
              return next
            })
            setNavigationNotice(null)
            setSessionCheckedPointIds((prev) => (prev.includes(pointId) ? prev : [...prev, pointId]))
            setCheckInTargetId(null)
            onStatesUpdated?.()
          }}
          onClose={() => setCheckInTargetId(null)}
        />
      ) : null}

      {showSessionShareCard ? (
        <div className="fixed inset-0 z-[170] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <RouteBookCard
            animeTitle={bangumi.card.title || ''}
            routeBookTitle={`${bangumi.card.title || ''} · 本次快速巡礼`}
            cityName={bangumi.card.city || ''}
            totalPoints={sessionCheckedPointIds.length}
            totalDistance={sessionTotalDistance}
            completionDate={new Date().toLocaleDateString('zh-CN')}
            points={sessionSharePoints}
            featuredImages={featuredSessionImages}
            shareUrl={typeof window !== 'undefined' ? window.location.href : ''}
            onClose={() => setShowSessionShareCard(false)}
          />
        </div>
      ) : null}
    </div>
  )
}
