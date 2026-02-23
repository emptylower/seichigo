'use client'

import { useState, useCallback, useRef } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import ComparisonImageGenerator from '@/components/comparison/ComparisonImageGenerator'

type CheckInModalProps = {
  pointId: string
  pointName: string
  referenceImageUrl?: string | null
  pointGeo?: { lat: number; lng: number } | null
  animeTitle?: string
  episode?: string | null
  submitLabel?: string
  onComparisonGenerated?: (blob: Blob) => void
  onSuccess: () => void
  onClose: () => void
}

function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2)
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

const GPS_THRESHOLD_METERS = 200

export default function CheckInModal({
  pointId,
  pointName,
  referenceImageUrl,
  pointGeo,
  animeTitle,
  episode,
  submitLabel,
  onComparisonGenerated,
  onSuccess,
  onClose,
}: CheckInModalProps) {
  const [photo, setPhoto] = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const [gpsStatus, setGpsStatus] = useState<'idle' | 'checking' | 'near' | 'far' | 'unavailable'>('idle')
  const [showFarConfirm, setShowFarConfirm] = useState(false)
  const [success, setSuccess] = useState(false)
  const [showComparison, setShowComparison] = useState(false)
  const [comparisonReady, setComparisonReady] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const handlePhotoChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setPhoto(file)
    const url = URL.createObjectURL(file)
    setPhotoPreview(url)
    setComparisonReady(false)
  }, [])

  const doCheckIn = useCallback(async () => {
    setChecking(true)
    try {
      const res = await fetch('/api/me/point-states', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pointId, state: 'checked_in' }),
      })
      if (res.ok) {
        setSuccess(true)
        setTimeout(() => onSuccess(), 900)
      }
    } catch {
      // noop
    }
    setChecking(false)
  }, [pointId, onSuccess])

  const handleCheckIn = useCallback(async () => {
    if (!pointGeo) {
      await doCheckIn()
      return
    }

    setGpsStatus('checking')
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 30000,
        })
      })
      const dist = haversineDistance(pos.coords.latitude, pos.coords.longitude, pointGeo.lat, pointGeo.lng)
      if (dist <= GPS_THRESHOLD_METERS) {
        setGpsStatus('near')
        await doCheckIn()
      } else {
        setGpsStatus('far')
        setShowFarConfirm(true)
      }
    } catch {
      setGpsStatus('unavailable')
      await doCheckIn()
    }
  }, [pointGeo, doCheckIn])

  if (success) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
        <div className="animate-bounce rounded-2xl bg-white px-8 py-6 text-center shadow-xl" onClick={(e) => e.stopPropagation()}>
          <div className="text-4xl">&#10003;</div>
          <div className="mt-2 text-lg font-semibold text-green-600">打卡成功</div>
          <div className="mt-1 text-sm text-slate-500">{pointName}</div>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
        <div
          className="mx-4 w-full max-w-sm rounded-2xl bg-white shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="border-b border-slate-200 px-4 py-3">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900">打卡 · {pointName}</h3>
              <button
                type="button"
                className="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                onClick={onClose}
                aria-label="关闭"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M4 4l8 8M12 4l-8 8" />
                </svg>
              </button>
            </div>
          </div>

          <div className="space-y-3 px-4 py-4">
            <div className="space-y-1.5">
              <div className="text-xs font-medium text-slate-500">动画/原作原图</div>
              <div className="aspect-[16/9] overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
                {referenceImageUrl ? (
                  <img
                    src={referenceImageUrl}
                    alt={`${pointName} 参考`}
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center px-4 text-center text-xs text-slate-500">
                    暂无可用原图，仍可上传照片继续打卡
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="text-xs font-medium text-slate-500">上传区</div>
              <button
                type="button"
                className="flex w-full items-center justify-center rounded-xl border-2 border-dashed border-brand-300 bg-brand-50/50 py-6 text-sm text-slate-500 hover:border-brand-400 hover:text-brand-600"
                onClick={() => fileRef.current?.click()}
              >
                {photoPreview ? (
                  <img src={photoPreview} alt="上传的照片" className="max-h-40 rounded-lg object-contain" />
                ) : (
                  <span>点击上传照片（可选）</span>
                )}
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handlePhotoChange}
              />
            </div>

            {photo ? (
              <button
                type="button"
                className="w-full rounded-lg border border-brand-300 bg-brand-50 px-3 py-2 text-xs font-medium text-brand-700 hover:bg-brand-100"
                onClick={() => setShowComparison(true)}
              >
                {comparisonReady ? '重新制作对比图（可选）' : '制作对比图（可选）'}
              </button>
            ) : null}

            {showFarConfirm ? (
              <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-700">
                当前位置距离打卡点较远（超过 {GPS_THRESHOLD_METERS}m），确定要打卡吗？
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    className="rounded-md bg-amber-500 px-3 py-1 text-xs text-white hover:bg-amber-600"
                    onClick={() => {
                      setShowFarConfirm(false)
                      doCheckIn().catch(() => null)
                    }}
                  >
                    确定打卡
                  </button>
                  <button
                    type="button"
                    className="rounded-md border border-amber-300 px-3 py-1 text-xs text-amber-700 hover:bg-amber-100"
                    onClick={() => {
                      setShowFarConfirm(false)
                      setGpsStatus('idle')
                    }}
                  >
                    取消
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          <div className="border-t border-slate-200 px-4 py-3">
            <button
              type="button"
              disabled={checking || showFarConfirm}
              className="w-full rounded-xl bg-green-500 py-2.5 text-sm font-semibold text-white hover:bg-green-600 disabled:opacity-50"
              onClick={() => {
                handleCheckIn().catch(() => null)
              }}
            >
              {checking
                ? gpsStatus === 'checking'
                  ? '定位中…'
                  : '打卡中…'
                : submitLabel || '完成打卡'}
            </button>
            {photo ? (
              <div className="mt-2 text-center text-xs text-slate-500">
                {comparisonReady ? '对比图已生成，可继续下一步。' : '可先制作对比图，也可直接下一步。'}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <Dialog.Root open={showComparison} onOpenChange={setShowComparison}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm" />
          <Dialog.Content className="fixed left-1/2 bottom-0 z-[61] w-full max-w-2xl -translate-x-1/2 focus:outline-none sm:top-1/2 sm:bottom-auto sm:-translate-y-1/2">
            <ComparisonImageGenerator
              animeImage={referenceImageUrl || ''}
              animeTitle={animeTitle || ''}
              pointName={pointName}
              episode={episode}
              initialUserImage={photo || photoPreview || undefined}
              onClose={() => setShowComparison(false)}
              onSuccess={(blob) => {
                setComparisonReady(true)
                onComparisonGenerated?.(blob)
              }}
            />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  )
}
