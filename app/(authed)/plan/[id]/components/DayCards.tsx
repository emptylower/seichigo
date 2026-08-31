'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Bus, Footprints, List, Loader2, Map as MapIcon, MapPin } from 'lucide-react'
import { RoutePreviewMap } from '@/components/route/RoutePreviewMap'
import type { TripPlanDayView, TripPlanItemView, TripPlanView } from '@/lib/tripPlan/view'

type RouteLineString = { type: 'LineString'; coordinates: [number, number][] }

type TransitPayload = {
  mode?: string
  durationMin?: number
  distanceKm?: number
}

const TYPE_LABELS: Record<string, string> = {
  point: '点位',
  meal: '用餐',
  lodging: '住宿',
  attraction: '景点',
  free: '自由',
}

const ROUTE_FETCH_DEBOUNCE_MS = 600

function getTransitPayload(item: TripPlanItemView): TransitPayload | null {
  const payload = item.payload
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  const raw = payload as Record<string, unknown>
  const result: TransitPayload = {}
  if (typeof raw.mode === 'string') result.mode = raw.mode
  if (typeof raw.durationMin === 'number' && Number.isFinite(raw.durationMin)) result.durationMin = raw.durationMin
  if (typeof raw.distanceKm === 'number' && Number.isFinite(raw.distanceKm)) result.distanceKm = raw.distanceKm
  return Object.keys(result).length ? result : null
}

/** "步行 8 分钟 · 650m"；<1km 用米展示更直观，否则保留 1 位小数的 km */
export function formatTransitText(payload: TransitPayload): string {
  const parts: string[] = []
  if (typeof payload.durationMin === 'number') {
    parts.push(`${payload.mode === 'walk' ? '步行' : '乘车'} ${Math.round(payload.durationMin)} 分钟`)
  }
  if (typeof payload.distanceKm === 'number' && payload.distanceKm > 0) {
    parts.push(
      payload.distanceKm < 1
        ? `${Math.round(payload.distanceKm * 1000)}m`
        : `${payload.distanceKm.toFixed(1)}km`,
    )
  }
  return parts.join(' · ')
}

function formatDayDate(date: string | null): string | null {
  if (!date) return null
  // ISO 串直接切月/日，避免时区换算偏移
  const match = /^\d{4}-(\d{2})-(\d{2})/.exec(date)
  if (!match) return null
  return `${Number(match[1])}/${Number(match[2])}`
}

function TransitConnectorRow(props: { item: TripPlanItemView }) {
  const { item } = props
  const payload = getTransitPayload(item)
  const structured = payload ? formatTransitText(payload) : ''
  // 旧数据/LLM 未按 schema 写 payload 时兜底用 title/note，绝不空行
  const text = structured || [item.title, item.note].filter(Boolean).join(' · ')
  const Icon = payload?.mode === 'walk' ? Footprints : Bus
  return (
    <li className="flex items-center gap-2 pl-9 py-1 text-xs text-gray-400">
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 truncate">{text}</span>
    </li>
  )
}

function TimelineCardRow(props: { item: TripPlanItemView; seq: number | null; showLine: boolean }) {
  const { item, seq, showLine } = props
  const isPoint = item.type === 'point'
  const image = item.point?.image ?? null
  const description = item.reason ?? item.note ?? null
  return (
    <li className="flex gap-3 px-4 py-3">
      {/* 左列：序号徽标 + 向下连接线（点位计序号，其他类型灰点弱化） */}
      <div className="flex w-6 shrink-0 flex-col items-center gap-1">
        {isPoint ? (
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white">
            {seq}
          </span>
        ) : (
          <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-gray-300" />
        )}
        {showLine ? <span className="w-px flex-1 bg-gray-200" /> : null}
      </div>

      {/* 图片：无图/非点位 → 渐变占位 + pin 图标 */}
      <div className="h-20 w-20 shrink-0 overflow-hidden rounded-xl sm:h-24 sm:w-24">
        {isPoint && image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image} alt={item.title} className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-brand-100 to-pink-50">
            <MapPin className="h-6 w-6 text-brand-300" />
          </div>
        )}
      </div>

      {/* 内容区 */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="min-w-0 truncate text-sm font-semibold text-gray-900">{item.title}</span>
          {item.timeHint ? (
            <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-500">{item.timeHint}</span>
          ) : null}
          {!isPoint && TYPE_LABELS[item.type] ? (
            <span className="shrink-0 rounded bg-gray-50 px-1.5 py-0.5 text-[11px] text-gray-400">{TYPE_LABELS[item.type]}</span>
          ) : null}
        </div>
        {description ? <p className="mt-1 text-xs text-gray-500 line-clamp-2">{description}</p> : null}
      </div>
    </li>
  )
}

function DayMap(props: { planId: string; day: TripPlanDayView }) {
  const { planId, day } = props
  const [geometry, setGeometry] = useState<RouteLineString | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [retryToken, setRetryToken] = useState(0)
  const cacheRef = useRef<Map<string, RouteLineString>>(new Map())

  // 当天 type=point 且有坐标的条目（序号与列表徽标一致：只数 point）
  const dayPoints = useMemo(() => {
    const result: Array<{ lat: number; lng: number; label: string }> = []
    let seq = 0
    for (const item of day.items) {
      if (item.type !== 'point') continue
      seq += 1
      const lat = item.point?.lat
      const lng = item.point?.lng
      if (lat == null || lng == null) continue
      result.push({ lat, lng, label: String(seq) })
    }
    return result
  }, [day])

  const signature = dayPoints.map((p) => `${p.lng},${p.lat}`).join('|')

  useEffect(() => {
    // <2 个点位不发请求，交由 RoutePreviewMap 退化为站点直连示意/单点
    if (dayPoints.length < 2) {
      setGeometry(null)
      setError(null)
      setLoading(false)
      return
    }
    const cached = cacheRef.current.get(signature)
    if (cached) {
      setGeometry(cached)
      setError(null)
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/me/plans/${planId}/route-geometry?points=${encodeURIComponent(signature)}&mode=walking`,
        )
        const data = (await res.json().catch(() => null)) as
          | { ok?: boolean; geometry?: RouteLineString; error?: string }
          | null
        if (cancelled) return
        if (res.ok && data?.ok && data.geometry) {
          cacheRef.current.set(signature, data.geometry)
          setGeometry(data.geometry)
          setError(null)
        } else {
          setGeometry(null)
          setError(data?.error ?? '路线加载失败')
        }
      } catch {
        if (!cancelled) {
          setGeometry(null)
          setError('网络错误')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, ROUTE_FETCH_DEBOUNCE_MS)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
    // retryToken 手动重试；signature 变化（切天/plan 更新）自动重取
  }, [planId, signature, dayPoints.length, retryToken])

  if (!dayPoints.length) {
    return (
      <div className="mx-4 mb-4 flex h-40 items-center justify-center rounded-2xl bg-gray-50 text-xs text-gray-400">
        当天还没有带坐标的点位
      </div>
    )
  }

  return (
    <div className="relative mx-4 mb-4 h-64 sm:h-80">
      <RoutePreviewMap
        points={dayPoints}
        routeGeometry={geometry}
        interactive={false}
        className="h-full w-full overflow-hidden rounded-2xl"
      />
      <div className="pointer-events-none absolute right-3 top-3 rounded-full bg-white/90 px-2.5 py-1 text-[11px] text-gray-500 shadow-sm">
        双指缩放地图
      </div>
      {loading ? (
        <div className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-white/90 px-2.5 py-1 text-[11px] text-gray-500 shadow-sm">
          <Loader2 className="h-3 w-3 animate-spin" />
          路线加载中…
        </div>
      ) : null}
      {!loading && error ? (
        <button
          type="button"
          onClick={() => setRetryToken((t) => t + 1)}
          className="absolute bottom-3 left-3 rounded-full bg-white/95 px-2.5 py-1 text-[11px] font-medium text-red-500 shadow-sm"
        >
          路线加载失败 · 重试
        </button>
      ) : null}
    </div>
  )
}

export function DayCards(props: {
  plan: TripPlanView
  planId: string
  selectedDay: number
  onSelectDay: (dayIndex: number) => void
}) {
  const { plan, planId, selectedDay, onSelectDay } = props
  const router = useRouter()
  const [view, setView] = useState<'list' | 'map'>('list')
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [savedRouteBookId, setSavedRouteBookId] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  async function handleSave() {
    if (saveState === 'saving') return
    if (saveState === 'saved' && savedRouteBookId) {
      router.push(`/me/routebooks/${savedRouteBookId}`)
      return
    }
    setSaveState('saving')
    setSaveError(null)
    try {
      const res = await fetch(`/api/me/plans/${planId}/export-routebook`, { method: 'POST' })
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; routeBookId?: string; error?: string }
        | null
      if (res.ok && data?.ok && typeof data.routeBookId === 'string') {
        setSavedRouteBookId(data.routeBookId)
        setSaveState('saved')
      } else {
        setSaveState('idle')
        setSaveError(data?.error ?? '保存失败，请稍后再试')
      }
    } catch {
      setSaveState('idle')
      setSaveError('网络错误，请稍后再试')
    }
  }

  if (!plan.days.length) {
    return (
      <div className="rounded-2xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">
        还没有行程——在左侧告诉规划师你想去哪、巡礼哪部作品吧。
      </div>
    )
  }

  const active = plan.days.find((d) => d.dayIndex === selectedDay) ?? plan.days[0]!

  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
      {/* header：列表/地图切换 + 保存到我的地图 */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-4 py-3">
        <div className="inline-flex rounded-full bg-gray-100 p-0.5 text-xs">
          {(
            [
              { key: 'list', label: '列表', Icon: List },
              { key: 'map', label: '地图', Icon: MapIcon },
            ] as const
          ).map(({ key, label, Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setView(key)}
              className={
                view === key
                  ? 'inline-flex items-center gap-1 rounded-full bg-white px-3 py-1 font-semibold text-gray-900 shadow-sm'
                  : 'inline-flex items-center gap-1 rounded-full px-3 py-1 text-gray-500'
              }
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {saveError ? <span className="text-xs text-red-500">{saveError}</span> : null}
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saveState === 'saving'}
            className={
              saveState === 'saved'
                ? 'inline-flex items-center gap-1.5 rounded-full border border-brand-200 bg-white px-4 py-1.5 text-xs font-semibold text-brand-600'
                : 'inline-flex items-center gap-1.5 rounded-full bg-brand-600 px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-60'
            }
          >
            {saveState === 'saving' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            {saveState === 'saved' ? '已保存 · 查看我的地图' : '保存到我的地图'}
          </button>
        </div>
      </div>

      {/* 天数 tab */}
      <div className="flex gap-2 overflow-x-auto px-4 pt-3">
        {plan.days.map((day) => {
          const date = formatDayDate(day.date)
          return (
            <button
              key={day.id}
              type="button"
              onClick={() => onSelectDay(day.dayIndex)}
              className={
                day.dayIndex === active.dayIndex
                  ? 'shrink-0 rounded-full bg-brand-600 px-4 py-1.5 text-sm font-semibold text-white'
                  : 'shrink-0 rounded-full border border-gray-200 bg-white px-4 py-1.5 text-sm text-gray-600 hover:border-brand-300'
              }
            >
              {`Day ${day.dayIndex}`}
              {date ? <span className="ml-1 text-xs opacity-80">· {date}</span> : null}
            </button>
          )
        })}
      </div>

      {active.summary ? <p className="px-4 pt-2 text-sm font-medium text-gray-700">{active.summary}</p> : null}

      {view === 'list' ? (
        <ol className="max-h-96 overflow-y-auto py-1">
          {(() => {
            let seq = 0
            return active.items.map((item, idx) => {
              if (item.type === 'transit') {
                return <TransitConnectorRow key={item.id} item={item} />
              }
              const isPoint = item.type === 'point'
              if (isPoint) seq += 1
              return (
                <TimelineCardRow
                  key={item.id}
                  item={item}
                  seq={isPoint ? seq : null}
                  showLine={idx < active.items.length - 1}
                />
              )
            })
          })()}
        </ol>
      ) : (
        <div className="pt-3">
          <DayMap planId={planId} day={active} />
        </div>
      )}
    </div>
  )
}
