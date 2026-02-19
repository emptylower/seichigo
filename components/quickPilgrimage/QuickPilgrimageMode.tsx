'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { X, Navigation, SkipForward, CheckCircle2, MapPin, Film, ChevronRight, Award, Map as MapIcon } from 'lucide-react'
import { AnitabiPointDTO, AnitabiBangumiDTO } from '@/lib/anitabi/types'
import { getHaversineDistance, resolveAnitabiAssetUrl } from '@/lib/anitabi/utils'
import { cn } from '@/lib/utils'

interface Props {
  bangumi: AnitabiBangumiDTO
  userPointStates: Record<string, string>
  onClose: () => void
  onCheckIn: (pointId: string) => void
}

export default function QuickPilgrimageMode({ bangumi, userPointStates, onClose, onCheckIn }: Props) {
  const [step, setStep] = useState<'intro' | 'cards' | 'summary'>('intro')
  const [currentIndex, setCurrentIndex] = useState(0)
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null)
  const [navigatingPointId, setNavigatingPointId] = useState<string | null>(null)
  const [isExiting, setIsExiting] = useState(false)

  // Fetch user location for sorting
  useEffect(() => {
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude })
        },
        (err) => {
          console.warn('[QuickPilgrimage] Geolocation failed', err)
        },
        { enableHighAccuracy: true, timeout: 5000 }
      )
    }
  }, [])

  // Listen for return from navigation
  useEffect(() => {
    const handleFocus = () => {
      if (navigatingPointId) {
        onCheckIn(navigatingPointId)
        setNavigatingPointId(null)
      }
    }
    window.addEventListener('focus', handleFocus)
    return () => window.removeEventListener('focus', handleFocus)
  }, [navigatingPointId, onCheckIn])

  // Filter and sort points
  const points = useMemo(() => {
    let list = [...bangumi.points]
    
    // Auto-skip checked-in points
    list = list.filter(p => userPointStates[p.id] !== 'checked_in')

    if (userLocation) {
      list.sort((a, b) => {
        if (!a.geo || !b.geo) return 0
        const da = getHaversineDistance(userLocation.lat, userLocation.lng, a.geo[0], a.geo[1])
        const db = getHaversineDistance(userLocation.lat, userLocation.lng, b.geo[0], b.geo[1])
        return da - db
      })
    } else {
      // Sort by episode / ID
      list.sort((a, b) => {
        const epA = parseInt(a.ep || '0') || 999
        const epB = parseInt(b.ep || '0') || 999
        if (epA !== epB) return epA - epB
        return a.id.localeCompare(b.id)
      })
    }
    return list
  }, [bangumi.points, userLocation, userPointStates])

  const totalPoints = bangumi.points.length
  const checkedInCount = bangumi.points.filter(p => userPointStates[p.id] === 'checked_in').length
  const remainingPoints = points.length

  const currentPoint = points[currentIndex]

  const handleNext = () => {
    if (currentIndex < points.length - 1) {
      setCurrentIndex(prev => prev + 1)
    } else {
      setStep('summary')
    }
  }

  const handleNavigate = () => {
    if (!currentPoint) return
    const dest = currentPoint.geo ? `${currentPoint.geo[0]},${currentPoint.geo[1]}` : currentPoint.name
    const url = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}`
    setNavigatingPointId(currentPoint.id)
    window.open(url, '_blank')
  }

  const handleClose = () => {
    setIsExiting(true)
    setTimeout(onClose, 300)
  }

  if (isExiting) {
    return (
      <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm transition-opacity duration-300 animate-out fade-out" />
    )
  }

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-slate-950 text-slate-50 overflow-hidden animate-in fade-in duration-500">
      {/* Background Gradient Mesh */}
      <div className="absolute inset-0 -z-10 overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-brand-500/20 blur-[120px] rounded-full animate-pulse" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-blue-500/10 blur-[120px] rounded-full" />
      </div>

      {/* Top Bar */}
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
          onClick={handleClose}
          className="p-2 rounded-full bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-colors border border-white/10"
        >
          <X size={20} />
        </button>
      </div>

      {/* Main Content Area */}
      <div className="relative flex-1 flex flex-col items-center justify-center p-6 pb-12">
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
            <h1 className="text-3xl font-black mb-3 tracking-tight">
              开始巡礼
            </h1>
            <p className="text-slate-400 text-sm mb-10 leading-relaxed px-4">
              我们将按距离为你规划最佳巡礼路线，带你寻找那些熟悉的次元风景。
            </p>
            <button 
              onClick={() => remainingPoints > 0 ? setStep('cards') : setStep('summary')}
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

        {step === 'cards' && currentPoint && (
          <div key={currentPoint.id} className="flex flex-col items-center w-full max-w-md animate-in slide-in-from-right-8 fade-in duration-500">
            {/* Card Header Info */}
            <div className="w-full flex justify-between items-end mb-4 px-2">
              <div className="space-y-1">
                <span className="inline-block px-2.5 py-1 rounded-md bg-brand-500/10 text-brand-400 text-[10px] font-bold tracking-widest uppercase border border-brand-500/20">
                  {currentPoint.ep ? `EP. ${currentPoint.ep}` : 'POI'}
                </span>
                <h3 className="text-xl font-bold line-clamp-1">{currentPoint.nameZh || currentPoint.name}</h3>
              </div>
              <div className="text-right">
                <div className="text-[10px] text-slate-500 font-bold tracking-widest uppercase">Progress</div>
                <div className="text-sm font-mono font-bold text-slate-300">
                  {currentIndex + 1} / {points.length}
                </div>
              </div>
            </div>

            {/* Main Visual Card */}
            <div className="relative w-full aspect-video bg-slate-900 rounded-3xl overflow-hidden shadow-2xl ring-1 ring-white/10 group">
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
              {currentPoint.image ? (
                <img 
                  src={resolveAnitabiAssetUrl(currentPoint.image) || ''} 
                  alt={currentPoint.name}
                  className="h-full w-full object-cover transition-transform duration-1000 group-hover:scale-105"
                />
              ) : (
                <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-600">
                  <Film size={48} strokeWidth={1} />
                  <p className="text-xs font-medium uppercase tracking-widest">No Screenshot</p>
                </div>
              )}
              
              {/* Distance Tag */}
              {userLocation && currentPoint.geo && (
                <div className="absolute top-4 right-4 px-3 py-1.5 rounded-full bg-black/60 backdrop-blur-md border border-white/10 text-[10px] font-bold flex items-center gap-1.5">
                  <Navigation size={10} className="text-brand-400" />
                  {getHaversineDistance(userLocation.lat, userLocation.lng, currentPoint.geo[0], currentPoint.geo[1]) > 1000 
                    ? `${(getHaversineDistance(userLocation.lat, userLocation.lng, currentPoint.geo[0], currentPoint.geo[1]) / 1000).toFixed(1)} km`
                    : `${Math.round(getHaversineDistance(userLocation.lat, userLocation.lng, currentPoint.geo[0], currentPoint.geo[1]))} m`
                  }
                </div>
              )}
            </div>

            {/* Note / Description */}
            <div className="mt-6 w-full px-4 text-center">
              <p className="text-sm text-slate-400 leading-relaxed italic">
                {currentPoint.note || '这曾是故事发生的瞬间。'}
              </p>
            </div>

            {/* Bottom Actions */}
            <div className="mt-10 grid grid-cols-2 gap-4 w-full">
              <button 
                onClick={handleNavigate}
                className="flex flex-col items-center justify-center gap-2 bg-white text-slate-950 py-5 rounded-[2rem] font-black transition-all hover:bg-slate-100 active:scale-95 group shadow-xl"
              >
                <div className="p-2 rounded-full bg-slate-100 group-hover:bg-slate-200 transition-colors">
                  <Navigation size={24} />
                </div>
                <span className="text-sm tracking-tight">导航到这里</span>
              </button>
              <button 
                onClick={handleNext}
                className="flex flex-col items-center justify-center gap-2 bg-slate-900 text-white py-5 rounded-[2rem] font-black border border-white/10 transition-all hover:bg-slate-800 active:scale-95 group"
              >
                <div className="p-2 rounded-full bg-slate-800 group-hover:bg-slate-700 transition-colors text-slate-400 group-hover:text-white">
                  <SkipForward size={24} />
                </div>
                <span className="text-sm tracking-tight">跳过</span>
              </button>
            </div>
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
                ? '恭喜你！已完成了全部地点的巡礼，你是最棒的圣地探索者。' 
                : `你已经浏览了本次行程的所有地点。继续发现更多圣地吧！`
              }
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
              onClick={handleClose}
              className="flex items-center gap-2 bg-white text-slate-950 px-12 py-4 rounded-full font-bold shadow-xl transition-all hover:scale-105 active:scale-95"
            >
              <MapIcon size={18} />
              返回地图
            </button>
          </div>
        )}
      </div>

      {/* Progress Bar (at bottom) */}
      {step === 'cards' && (
        <div className="absolute bottom-0 left-0 w-full h-1 bg-slate-900">
          <div 
            className="h-full bg-brand-500 transition-all duration-500 ease-out"
            style={{ width: `${((currentIndex + 1) / points.length) * 100}%` }}
          />
        </div>
      )}
    </div>
  )
}
