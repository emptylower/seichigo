'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Bus, Car, Footprints, List, Loader2, Map as MapIcon, MapPin } from 'lucide-react'
import { RoutePreviewMap } from '@/components/route/RoutePreviewMap'
import ResilientMapImage from '@/components/map/ResilientMapImage'
import { useDragToScroll } from '@/lib/hooks/useDragToScroll'
import { MarkdownBubble } from './MarkdownBubble'
import {
  collectProviderGeometry,
  dayTravelMode,
  ensureDayScheduleForRender,
  formatLegsText,
  formatTransportText,
  getMedia,
  getPlace,
  getSchedule,
  getTransport,
  isNumberedVisitItem,
  isRoutablePointItem,
  itemLatLng,
  sortItemsBySchedule,
} from './itemPayload'
import type { DaymapMessagePayload, TripPlanDayView, TripPlanItemView } from '@/lib/tripPlan/view'

type RouteLineString = { type: 'LineString'; coordinates: [number, number][] }

const TYPE_LABELS: Record<string, string> = {
  point: '点位',
  meal: '用餐',
  lodging: '住宿',
  attraction: '景点',
  free: '自由',
}

const SCHEDULE_CONFIDENCE_LABELS: Record<string, string> = {
  explicit: '',
  reference: '参考',
  estimated: '预估',
}

type RouteGeometryResult = { ok: true; geometry: RouteLineString } | { ok: false; error: string }

// 路线几何模块级缓存：跨 列表/地图 tab 切换、组件重挂载复用；
// DayCards 挂载时后台预取各天路线，切到地图 tab 直接命中
const routeGeometryCache = new Map<string, RouteLineString>()
const routeGeometryInflight = new Map<string, Promise<RouteGeometryResult>>()

function routeCacheKey(planId: string, signature: string, mode: string): string {
  return `${planId}:${signature}:${mode}`
}

/** 拉取某天真实道路路线（同源 API，失败结果不缓存以便重试；同 signature 在途请求去重） */
function fetchRouteGeometry(planId: string, signature: string, mode: 'walking' | 'driving'): Promise<RouteGeometryResult> {
  const key = routeCacheKey(planId, signature, mode)
  const cached = routeGeometryCache.get(key)
  if (cached) return Promise.resolve({ ok: true, geometry: cached })
  const inflight = routeGeometryInflight.get(key)
  if (inflight) return inflight
  const promise = (async (): Promise<RouteGeometryResult> => {
    try {
      const res = await fetch(
        `/api/me/plans/${planId}/route-geometry?points=${encodeURIComponent(signature)}&mode=${mode}`,
      )
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; geometry?: RouteLineString; error?: string }
        | null
      if (res.ok && data?.ok && data.geometry) {
        routeGeometryCache.set(key, data.geometry)
        return { ok: true, geometry: data.geometry }
      }
      return { ok: false, error: data?.error ?? '路线加载失败' }
    } catch {
      return { ok: false, error: '网络错误' }
    } finally {
      routeGeometryInflight.delete(key)
    }
  })()
  routeGeometryInflight.set(key, promise)
  return promise
}

/** 当天参与地图/路线的点（必须有坐标：站内点位 + 外部地点）；渲染期时间兜底后排序 */
function dayRoutePoints(day: TripPlanDayView): Array<{ lat: number; lng: number; label: string }> {
  const result: Array<{ lat: number; lng: number; label: string }> = []
  let seq = 0
  for (const item of sortItemsBySchedule(ensureDayScheduleForRender(day.items))) {
    if (!isRoutablePointItem(item)) continue
    const latLng = itemLatLng(item)
    if (!latLng) continue
    seq += 1
    result.push({ lat: latLng.lat, lng: latLng.lng, label: String(seq) })
  }
  return result
}

function routeSignature(points: Array<{ lat: number; lng: number }>): string {
  return points.map((p) => `${p.lng},${p.lat}`).join('|')
}

function formatDayDate(date: string | null): string | null {
  if (!date) return null
  // ISO 串直接切月/日，避免时区换算偏移
  const match = /^\d{4}-(\d{2})-(\d{2})/.exec(date)
  if (!match) return null
  return `${Number(match[1])}/${Number(match[2])}`
}

function TransportModeIcon(props: { mode?: string }) {
  if (props.mode === 'walk') return <Footprints className="h-3.5 w-3.5 shrink-0" />
  if (props.mode === 'driving') return <Car className="h-3.5 w-3.5 shrink-0" />
  return <Bus className="h-3.5 w-3.5 shrink-0" />
}

function TransitConnectorRow(props: { item: TripPlanItemView }) {
  const { item } = props
  const transport = getTransport(item)
  const legsText = transport ? formatLegsText(transport) : null
  const mainText = transport ? formatTransportText(transport) : ''
  // 旧数据/LLM 未按 schema 写 payload 时兜底用 title/note，绝不空行
  const fallbackText = [item.title, item.note].filter(Boolean).join(' · ')
  const text = legsText || mainText || fallbackText
  const secondary = legsText ? mainText : null
  return (
    <li className="flex items-start gap-2 py-1 pl-9 text-xs text-gray-400">
      <span className="mt-0.5">
        <TransportModeIcon mode={transport?.mode} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate">{text}</span>
        {secondary ? <span className="block truncate text-[11px] text-gray-300">{secondary}</span> : null}
      </span>
    </li>
  )
}

function ScheduleTimeChip(props: { item: TripPlanItemView }) {
  const { item } = props
  const schedule = getSchedule(item)
  if (schedule) {
    const marker = SCHEDULE_CONFIDENCE_LABELS[schedule.confidence] ?? '预估'
    return (
      <span className="flex shrink-0 items-center gap-1">
        <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] tabular-nums text-gray-600">
          {schedule.start}–{schedule.end}
        </span>
        {marker ? (
          <span className="rounded bg-amber-50 px-1 py-0.5 text-[10px] text-amber-600" title="由宽泛时段换算的参考/预估时间">
            {marker}
          </span>
        ) : null}
      </span>
    )
  }
  // 历史数据：没有归一化 schedule 时展示原 timeHint（可能仍是"午后"）
  if (item.timeHint) {
    return <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-500">{item.timeHint}</span>
  }
  return null
}

function TimelineCardRow(props: { item: TripPlanItemView; seq: number | null; showLine: boolean }) {
  const { item, seq, showLine } = props
  // 计序口径（M3 修订）：type='point'（含历史缺坐标数据）与带 payload.place 的
  // 外部地点条目（point/attraction）都是完整行程点——计序号、展示媒体图；
  // 地图/路线仅纳入有坐标的点（dayRoutePoints 另行过滤）
  const isVisit = isNumberedVisitItem(item)
  // 图片阶梯与 /map 一致：外部地点（含 attraction）优先 payload.media
  // （keyless 代理 URL），站内点位用关联 point.image，都走 ResilientMapImage 候选梯
  const media = getMedia(item)
  const image = media?.displayUrl ?? item.point?.image ?? null
  const description = item.reason ?? item.note ?? null
  const isExternal = isVisit && !item.pointId && getPlace(item) !== null
  return (
    <li className="flex gap-3 px-4 py-3">
      {/* 左列：序号徽标 + 向下连接线（点位计序号，其他类型灰点弱化） */}
      <div className="flex w-6 shrink-0 flex-col items-center gap-1">
        {isVisit ? (
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white">
            {seq}
          </span>
        ) : (
          <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-gray-300" />
        )}
        {showLine ? <span className="w-px flex-1 bg-gray-200" /> : null}
      </div>

      {/* 图片：无图/非点位 → 渐变占位 + pin 图标；
          点位图复用地图的 ResilientMapImage（直连失败自动走 /api/anitabi/image-render 代理重试） */}
      <div className="h-20 w-20 shrink-0 overflow-hidden rounded-xl sm:h-24 sm:w-24">
        {isVisit && image ? (
          <ResilientMapImage
            src={image}
            alt={item.title}
            kind="point"
            className="h-full w-full object-cover"
            loading="lazy"
            fallback={
              <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-brand-100 to-pink-50">
                <MapPin className="h-6 w-6 text-brand-300" />
              </div>
            }
          />
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
          <ScheduleTimeChip item={item} />
          {!isVisit && TYPE_LABELS[item.type] ? (
            <span className="shrink-0 rounded bg-gray-50 px-1.5 py-0.5 text-[11px] text-gray-400">{TYPE_LABELS[item.type]}</span>
          ) : null}
          {isExternal ? (
            <span className="shrink-0 rounded bg-sky-50 px-1.5 py-0.5 text-[11px] text-sky-600" title="来自 Google 地点的非巡礼地点">
              Google 地点
            </span>
          ) : null}
        </div>
        {description ? (
          // AI 生成的推荐理由/备注，过 markdown 管线避免字面 ** 泄漏
          <div className="mt-1 line-clamp-2 text-xs text-gray-500">
            <MarkdownBubble text={description} />
          </div>
        ) : null}
      </div>
    </li>
  )
}

function DayMap(props: { planId: string; day: TripPlanDayView }) {
  const { planId, day } = props
  const [geometry, setGeometry] = useState<RouteLineString | null>(null)
  const [sourceLabel, setSourceLabel] = useState<'provider' | 'fallback' | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [retryToken, setRetryToken] = useState(0)

  // 当天参与路线的点（序号与列表徽标一致：站内点位 + 外部地点）
  const dayPoints = useMemo(() => dayRoutePoints(day), [day])
  // 与时间线同源的出行模式：任何自驾段 → driving，否则 walking
  const mode = useMemo(() => dayTravelMode(day.items), [day])
  // provider 几何（estimate_travel 落库的折线）：权威路线，优先于通用路网几何
  const providerGeometry = useMemo(() => collectProviderGeometry(day.items), [day])

  const signature = routeSignature(dayPoints)
  const hasProviderGeometry = providerGeometry.length >= 2

  useEffect(() => {
    if (dayPoints.length < 2) {
      setGeometry(null)
      setSourceLabel(null)
      setError(null)
      setLoading(false)
      return
    }
    if (hasProviderGeometry) {
      // 权威 provider 几何：与时间线描述的路线/模式同源，不再请求通用路网
      setGeometry({ type: 'LineString', coordinates: providerGeometry })
      setSourceLabel('provider')
      setError(null)
      setLoading(false)
      return
    }
    // 预取/上次渲染可能已填充模块级缓存，命中即同步展示
    const cached = routeGeometryCache.get(routeCacheKey(planId, signature, mode))
    if (cached) {
      setGeometry(cached)
      setSourceLabel('fallback')
      setError(null)
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    void fetchRouteGeometry(planId, signature, mode).then((result) => {
      if (cancelled) return
      if (result.ok) {
        setGeometry(result.geometry)
        setSourceLabel('fallback')
        setError(null)
      } else {
        setGeometry(null)
        setSourceLabel(null)
        setError(result.error)
      }
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
    // retryToken 手动重试；signature/mode 变化（切天/plan 更新）自动重取
  }, [planId, signature, mode, dayPoints.length, hasProviderGeometry, providerGeometry, retryToken])

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
      {sourceLabel === 'fallback' ? (
        <div
          className="pointer-events-none absolute right-3 top-9 rounded-full bg-white/90 px-2.5 py-1 text-[11px] text-gray-400 shadow-sm"
          title="未取到所选交通方式的权威路线，按路网示意连接"
        >
          参考路线（示意）
        </div>
      ) : null}
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
  planId: string
  /** 渲染的天列表：当前计划（live）或 daymap 快照（不可变副本） */
  days: TripPlanDayView[]
  /**
   * 行为作用域：current=当前计划（显示"保存到我的地图"，导出的是当前
   * 计划）；snapshot=历史 daymap 快照（只读展示，隐藏保存按钮——历史
   * 快照不可被悄悄修改，也不能误导用户以为导出的是这份快照）。
   * 切天状态在组件内部，多个 DayCards 实例（多张 daymap）互不影响。
   */
  scope?: 'current' | 'snapshot'
}) {
  const { planId, days, scope = 'current' } = props
  const router = useRouter()
  const [view, setView] = useState<'list' | 'map'>('list')
  const [selectedDay, setSelectedDay] = useState<number | null>(null)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [savedRouteBookId, setSavedRouteBookId] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  // 天数很多时 tab 横向溢出；滚动条全站隐藏后桌面鼠标靠拖拽访问
  const dayTabsDrag = useDragToScroll()

  // 后台预取各天真实道路路线（不阻塞渲染）：切到地图 tab 时命中模块级缓存直接展示，
  // 避免"切 tab 才开始请求"造成的明显等待；同 signature 请求在 fetchRouteGeometry 内去重。
  // 已有 provider 折线（estimate_travel 落库）的天优先用权威几何，不再预取通用路网。
  useEffect(() => {
    for (const day of days) {
      if (collectProviderGeometry(day.items).length >= 2) continue
      const points = dayRoutePoints(day)
      if (points.length < 2) continue
      void fetchRouteGeometry(planId, routeSignature(points), dayTravelMode(day.items))
    }
  }, [planId, days])

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

  if (!days.length) {
    return (
      <div className="rounded-2xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">
        还没有行程——在左侧告诉规划师你想去哪、巡礼哪部作品吧。
      </div>
    )
  }

  const active = days.find((d) => d.dayIndex === selectedDay) ?? days[0]
  // 渲染期时间兜底（M3 修订）：历史数据无 schedule 也推导出具体时钟时间；
  // 再按结构化时间防御性二次排序（不信任插入顺序，服务端已排过是双保险）
  const renderedItems = ensureDayScheduleForRender(active.items)
  const sortedItems = sortItemsBySchedule(renderedItems)

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
          {scope === 'snapshot' ? (
            <span className="text-xs text-gray-400">历史快照 · 只读</span>
          ) : (
            <>
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
            </>
          )}
        </div>
      </div>

      {/* 天数 tab */}
      <div ref={dayTabsDrag.ref} {...dayTabsDrag.handlers} className={`flex gap-2 overflow-x-auto px-4 pt-3 ${dayTabsDrag.cursorClass}`}>
        {days.map((day) => {
          const date = formatDayDate(day.date)
          return (
            <button
              key={day.id}
              type="button"
              onClick={() => setSelectedDay(day.dayIndex)}
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

      {active.summary ? (
        // AI 生成的 summary 走 markdown 管线（与聊天气泡同一套），避免字面 ** 泄漏
        <div className="px-4 pt-2 text-sm font-medium text-gray-700">
          <MarkdownBubble text={active.summary} />
        </div>
      ) : null}

      {view === 'list' ? (
        <ol className="max-h-96 overflow-y-auto py-1">
          {(() => {
            let seq = 0
            return sortedItems.map((item, idx) => {
              if (item.type === 'transit') {
                return <TransitConnectorRow key={item.id} item={item} />
              }
              const isVisit = isNumberedVisitItem(item)
              if (isVisit) seq += 1
              return (
                <TimelineCardRow
                  key={item.id}
                  item={item}
                  seq={isVisit ? seq : null}
                  showLine={idx < sortedItems.length - 1}
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

// ---------- daymap 聊天交付物包装 ----------

function formatDaymapSavedAt(iso: string): string {
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return ''
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * 聊天时间线里的 daymap 交付物：渲染 save_plan_days 成功那一刻的不可变
 * 快照（DayCards scope=snapshot，只读）。每个实例的 Day tab 状态独立，
 * 互不影响；路线优先用快照内的 provider 几何，缺失时走现有路线 API
 * 缓存与失败重试（DayCards/DayMap 既有行为）。
 */
export function DaymapCard(props: { planId: string; daymap: DaymapMessagePayload }) {
  const { daymap } = props
  const savedAtLabel = formatDaymapSavedAt(daymap.savedAt)
  return (
    <div data-daymap-revision={daymap.revisionId} className="pt-1">
      <div className="flex items-center gap-1.5 px-1 pb-1.5 text-xs text-gray-400">
        <MapIcon className="h-3.5 w-3.5 shrink-0" />
        <span>行程快照 · 已保存</span>
        {savedAtLabel ? <span className="tabular-nums">{savedAtLabel}</span> : null}
      </div>
      <DayCards planId={props.planId} days={daymap.days} scope="snapshot" />
    </div>
  )
}
