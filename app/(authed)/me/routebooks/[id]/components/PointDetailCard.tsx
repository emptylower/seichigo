'use client'

import { useEffect, useState } from 'react'
import { BedDouble, ChevronDown, ChevronUp, ExternalLink, MapPin, Navigation, Star, TrainFront, Utensils, X } from 'lucide-react'
import type { DayRecord, ItemRecord, PlaceKind, PlaceRecord, PointPreview } from '../types'
import { buildGoogleDirectionsUrl, dayLabel, pickPointGradient } from '../utils'

export type PlaceIntro = {
  name: string
  address: string | null
  rating: number | null
  userRatingsTotal: number | null
  summary: string | null
  openingHours: string[]
  website: string | null
  mapsUrl: string | null
}

type IntroState =
  | { status: 'idle' | 'loading' }
  | { status: 'ok'; intro: PlaceIntro }
  | { status: 'missing' }
  | { status: 'error' }

const PLACE_KIND_LABEL: Record<PlaceKind, string> = {
  lodging: '住宿',
  station: '车站',
  restaurant: '餐厅',
  other: '地点',
}

const PLACE_KIND_ICON: Record<PlaceKind, typeof MapPin> = {
  lodging: BedDouble,
  restaurant: Utensils,
  station: TrainFront,
  other: MapPin,
}

type PointDetailCardProps = {
  routeBookId: string
  item: ItemRecord
  preview: PointPreview | null
  place: PlaceRecord | null
  days: DayRecord[]
  /** 详情接口语言（zh-CN / en / ja） */
  lang: 'zh-CN' | 'en' | 'ja'
  onClose: () => void
  onDelete: () => void
  onMoveItem: (targetDayId: string | null) => void
  /** 移动端底部抽屉样式 */
  compact?: boolean
}

function formatRating(rating: number | null, total: number | null): string | null {
  if (rating === null) return null
  const count = total !== null ? ` · ${total.toLocaleString('zh-CN')} 条` : ''
  return `★ ${rating.toFixed(1)}${count}`
}

export function PointDetailCard({
  routeBookId,
  item,
  preview,
  place,
  days,
  lang,
  onClose,
  onDelete,
  onMoveItem,
  compact = false,
}: PointDetailCardProps) {
  const isPoint = item.kind === 'point'
  const [intro, setIntro] = useState<IntroState>({ status: 'idle' })
  const [hoursOpen, setHoursOpen] = useState(false)

  // 自定义点：挂载后拉谷歌介绍；404 → 占位文案；其它错误仅记录，不阻塞卡
  useEffect(() => {
    if (isPoint || !item.placeId) return
    let cancelled = false
    setIntro({ status: 'loading' })
    void (async () => {
      try {
        const res = await fetch(
          `/api/me/routebooks/${routeBookId}/places/${item.placeId}/intro?lang=${encodeURIComponent(lang)}`
        )
        if (cancelled) return
        if (res.status === 404) {
          setIntro({ status: 'missing' })
          return
        }
        if (!res.ok) {
          setIntro({ status: 'error' })
          return
        }
        const data = (await res.json().catch(() => null)) as { ok?: boolean; intro?: PlaceIntro } | null
        if (cancelled) return
        if (data?.ok && data.intro) {
          setIntro({ status: 'ok', intro: data.intro })
        } else {
          setIntro({ status: 'error' })
        }
      } catch {
        if (!cancelled) setIntro({ status: 'error' })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [isPoint, item.placeId, routeBookId, lang])

  const title = isPoint
    ? preview?.title || item.title || '点位'
    : place?.title || item.title || '地点'
  const subtitle = isPoint ? preview?.subtitle || null : null
  const address = isPoint ? null : place?.address ?? null
  const lat = isPoint ? preview?.geo?.[0] : place?.lat
  const lng = isPoint ? preview?.geo?.[1] : place?.lng
  const googleMapsUrl =
    typeof lat === 'number' && typeof lng === 'number'
      ? buildGoogleDirectionsUrl([`${lat},${lng}`])
      : null
  const pointMapUrl = isPoint && item.pointId ? `/map?p=${encodeURIComponent(item.pointId)}` : null
  const gradient = pickPointGradient(item.pointId ?? item.id)
  const KindIcon = place ? PLACE_KIND_ICON[place.kind] : MapPin

  const ratingLine =
    !isPoint && intro.status === 'ok' ? formatRating(intro.intro.rating, intro.intro.userRatingsTotal) : null

  return (
    <aside
      aria-label="点位详情"
      className={
        compact
          ? 'pointer-events-auto absolute inset-x-3 bottom-3 z-30 max-h-[62%] overflow-y-auto rounded-[24px] border border-pink-100/80 bg-white/98 shadow-[0_24px_48px_-24px_rgba(15,23,42,0.45)] backdrop-blur-md'
          : 'pointer-events-auto absolute bottom-4 left-4 z-30 w-[360px] max-w-[calc(100%-2rem)] overflow-hidden rounded-[24px] border border-pink-100/80 bg-white/98 shadow-[0_24px_48px_-24px_rgba(15,23,42,0.45)] backdrop-blur-md'
      }
    >
      <div className="relative">
        {isPoint ? (
          preview?.image ? (
            <div className="relative h-40 w-full overflow-hidden bg-slate-100">
              <img src={preview.image} alt={title} className="h-full w-full object-cover object-center" />
            </div>
          ) : (
            <div className={`flex h-32 w-full items-center justify-center bg-gradient-to-br ${gradient}`}>
              <span className="rounded-md bg-black/35 px-3 py-1.5 text-xs font-semibold text-white">暂无截图</span>
            </div>
          )
        ) : null}
        <button
          type="button"
          aria-label="关闭"
          onClick={onClose}
          className={`absolute right-2 top-2 inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-600 shadow-sm transition hover:bg-white ${
            isPoint ? 'bg-white/90' : 'bg-slate-100'
          }`}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-3 p-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {!isPoint && place ? (
              <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
                <KindIcon className="h-4 w-4" />
              </span>
            ) : null}
            <h3 className="min-w-0 flex-1 truncate text-base font-semibold text-slate-900">{title}</h3>
            {!isPoint && place ? (
              <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">
                {PLACE_KIND_LABEL[place.kind]}
              </span>
            ) : null}
          </div>
          {subtitle ? <div className="mt-0.5 truncate text-xs text-slate-500">{subtitle}</div> : null}
          {address ? <div className="mt-1 truncate text-xs text-slate-500">{address}</div> : null}
        </div>

        {!isPoint ? (
          <div className="space-y-2 text-sm">
            {intro.status === 'loading' ? (
              <div className="space-y-2" aria-label="加载中">
                <div className="h-3 w-24 animate-pulse rounded-full bg-slate-100" />
                <div className="h-3 w-full animate-pulse rounded-full bg-slate-100" />
                <div className="h-3 w-3/4 animate-pulse rounded-full bg-slate-100" />
              </div>
            ) : null}
            {intro.status === 'missing' || intro.status === 'error' ? (
              <div className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">暂无谷歌信息</div>
            ) : null}
            {intro.status === 'ok' ? (
              <>
                {ratingLine ? <div className="text-xs font-semibold text-amber-600">{ratingLine}</div> : null}
                {intro.intro.summary ? (
                  <p className="line-clamp-3 text-xs leading-5 text-slate-600">{intro.intro.summary}</p>
                ) : null}
                {intro.intro.openingHours.length > 0 ? (
                  <div className="rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2">
                    <button
                      type="button"
                      className="flex w-full items-center justify-between text-xs font-medium text-slate-600"
                      onClick={() => setHoursOpen((prev) => !prev)}
                    >
                      营业时间
                      {hoursOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    </button>
                    {hoursOpen ? (
                      <ul className="mt-1.5 space-y-0.5 text-[11px] leading-4 text-slate-500">
                        {intro.intro.openingHours.map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ) : null}
                <div className="flex flex-wrap gap-1.5">
                  {intro.intro.website ? (
                    <a
                      href={intro.intro.website}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex min-h-8 items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-600 no-underline transition hover:bg-slate-50"
                    >
                      <ExternalLink className="h-3 w-3" />
                      网站
                    </a>
                  ) : null}
                  {intro.intro.mapsUrl ? (
                    <a
                      href={intro.intro.mapsUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex min-h-8 items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-600 no-underline transition hover:bg-slate-50"
                    >
                      <Navigation className="h-3 w-3" />
                      在 Google 地图打开
                    </a>
                  ) : null}
                </div>
              </>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-1.5 border-t border-pink-100/70 pt-3">
          {pointMapUrl ? (
            <a
              href={pointMapUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-9 items-center gap-1.5 rounded-xl bg-brand-500 px-3 text-xs font-semibold text-white no-underline transition hover:bg-brand-600"
            >
              <MapPin className="h-3.5 w-3.5" />
              在巡礼地图查看
            </a>
          ) : null}
          {!isPoint && googleMapsUrl ? (
            <a
              href={googleMapsUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 no-underline transition hover:bg-slate-50"
            >
              <Navigation className="h-3.5 w-3.5 text-brand-500" />
              Google 地图
            </a>
          ) : null}
          {isPoint && googleMapsUrl ? (
            <a
              href={googleMapsUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 no-underline transition hover:bg-slate-50"
            >
              <Navigation className="h-3.5 w-3.5 text-brand-500" />
              Google 地图
            </a>
          ) : null}
          <select
            aria-label="移到…"
            title="移到…"
            value=""
            className="inline-flex min-h-9 cursor-pointer items-center rounded-xl border border-slate-200 bg-white px-2 text-xs font-medium text-slate-600 outline-none transition hover:bg-slate-50"
            onChange={(event) => {
              const value = event.target.value
              if (!value) return
              onMoveItem(value === 'unassigned' ? null : value)
            }}
          >
            <option value="" disabled>
              移到…
            </option>
            {days.map((day) => (
              <option key={day.id} value={day.id} disabled={day.id === item.dayId}>
                {dayLabel(day, day.dayIndex)}
              </option>
            ))}
            <option value="unassigned" disabled={item.dayId === null}>
              未安排
            </option>
          </select>
          <button
            type="button"
            className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50/70 px-3 text-xs font-medium text-rose-600 transition hover:bg-rose-100"
            onClick={onDelete}
          >
            从当天移除
          </button>
        </div>
      </div>
    </aside>
  )
}
