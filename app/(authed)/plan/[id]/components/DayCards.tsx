'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { List, Loader2, Map as MapIcon, MessageSquarePlus, Navigation } from 'lucide-react'
import { useDragToScroll } from '@/lib/hooks/useDragToScroll'
import { TierHint } from '@/components/billing/TierHint'
import { DaysLimitHint } from '@/components/billing/DaysLimitHint'
import type { TierHints } from '@/hooks/useUsage'
import { MarkdownBubble } from './MarkdownBubble'
import { TransitConnector } from './TransitConnector'
import { ItemThumbnail } from './ItemThumbnail'
import { DayMap } from './DayMapLazy'
import {
  dayTravelMode,
  ensureDayScheduleForRender,
  getMedia,
  getPlace,
  getSchedule,
  isNumberedVisitItem,
  isRoutablePointItem,
  itemLatLng,
  sortItemsBySchedule,
} from './itemPayload'
import { dayItemContentKeys, dayRoutePoints, fetchRouteGeometry, routeSignature } from './dayRouteGeometry'
import { composeDayRoute } from './dayRouteCompose'
import { buildDayNavigationUrls, buildPointNavigationUrl, defaultMaxNavigationWaypoints } from '../lib/navigationLinks'
import { planTextFor, type PlanTextFn } from '../lib/planText'
import { useClientFormattedTime } from '../hooks/useClientFormattedTime'
import { useDayAutoRotate } from '../hooks/useDayAutoRotate'
import type { SupportedLocale } from '@/lib/i18n/types'
import type { DaymapMessagePayload, TripPlanDayView, TripPlanItemView } from '@/lib/tripPlan/view'

/** 静态展示：当前天前 6 张缩略图 eager，其余 lazy（第二屏首帧直接出图） */
const EAGER_IMAGE_COUNT = 6

const TYPE_LABEL_KEYS: Record<string, string> = {
  point: 'day.typePoint',
  meal: 'day.typeMeal',
  lodging: 'day.typeLodging',
  attraction: 'day.typeAttraction',
  free: 'day.typeFree',
}

/** explicit 是模型显式给的时间，不加标注；其余按参考/预估标注 */
const SCHEDULE_CONFIDENCE_KEYS: Record<string, string | null> = {
  explicit: null,
  reference: 'day.confidenceReference',
  estimated: 'day.confidenceEstimated',
}

function formatDayDate(date: string | null): string | null {
  if (!date) return null
  // ISO 串直接切月/日，避免时区换算偏移
  const match = /^\d{4}-(\d{2})-(\d{2})/.exec(date)
  if (!match) return null
  return `${Number(match[1])}/${Number(match[2])}`
}

// 「交给规划师调整」预填文案（§0）：点位级带天数/序号/标题；整日级只带天数；
// 历史快照额外前缀「基于 {savedAt} 那版行程，」（快照不可悄悄修改，只做预填转述）
function snapshotDraftPrefix(tx: PlanTextFn, snapshotSavedAt?: string | null): string {
  return snapshotSavedAt ? tx('day.draftSnapshotPrefix', { savedAt: snapshotSavedAt }) : ''
}

function buildPointAdjustDraft(
  tx: PlanTextFn,
  day: number,
  seq: number,
  title: string,
  snapshotSavedAt?: string | null,
): string {
  return `${snapshotDraftPrefix(tx, snapshotSavedAt)}${tx('day.draftAdjustPoint', { day, seq, title })}`
}

function buildDayAdjustDraft(tx: PlanTextFn, day: number, snapshotSavedAt?: string | null): string {
  return `${snapshotDraftPrefix(tx, snapshotSavedAt)}${tx('day.draftAdjustDay', { day })}`
}

function ScheduleTimeChip(props: { item: TripPlanItemView; tx: PlanTextFn }) {
  const { item, tx } = props
  const schedule = getSchedule(item)
  if (schedule) {
    const markerKey =
      schedule.confidence in SCHEDULE_CONFIDENCE_KEYS
        ? SCHEDULE_CONFIDENCE_KEYS[schedule.confidence]!
        : 'day.confidenceEstimated'
    const marker = markerKey ? tx(markerKey) : ''
    return (
      <span className="flex shrink-0 items-center gap-1">
        <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] tabular-nums text-gray-600">
          {schedule.start}–{schedule.end}
        </span>
        {marker ? (
          <span className="rounded bg-amber-50 px-1 py-0.5 text-[10px] text-amber-600" title={tx('day.confidenceTitle')}>
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

function TimelineCardRow(props: {
  item: TripPlanItemView
  seq: number | null
  showLine: boolean
  /** 内容签名 key（与地图 marker 的 data-point-id 同值）；无坐标的条目为 null（不可点） */
  pointKey?: string | null
  active?: boolean
  flashing?: boolean
  onSelectPoint?: (id: string) => void
  /** 「在地图上看」：切到地图 tab 并高亮该点 */
  onShowOnMap?: (id: string) => void
  /** 所属天序号 + 快照时间戳：供「导航」与「交给规划师调整」文案使用 */
  dayIndex?: number
  snapshotSavedAt?: string | null
  onComposeDraft?: (text: string) => void
  /** 静态展示：不用需要登录的 /api/google/point-photo 兜底 */
  staticMode?: boolean
  /** 静态展示时当前天的前几张图 eager 加载（首帧直接出图），其余保持 lazy */
  eagerImage?: boolean
  /** 免费档：没有具体餐厅的用餐条目下给一条升级提示（设计 §4） */
  showRestaurantUpgradeHint?: boolean
  locale?: SupportedLocale
}) {
  const {
    item,
    seq,
    showLine,
    pointKey = null,
    active = false,
    flashing = false,
    onSelectPoint,
    onShowOnMap,
    dayIndex = 0,
    snapshotSavedAt = null,
    onComposeDraft,
    staticMode = false,
    eagerImage = false,
    showRestaurantUpgradeHint = false,
    locale = 'zh',
  } = props
  const tx = planTextFor(locale)
  // 计序口径（M3 修订）：type='point'（含历史缺坐标数据）与带 payload.place 的
  // 外部地点条目（point/attraction）都是完整行程点——计序号、展示媒体图；
  // 地图/路线仅纳入有坐标的点（dayRoutePoints 另行过滤）
  const isVisit = isNumberedVisitItem(item)
  // 图片阶梯与 /map 一致：外部地点（含 attraction）优先 payload.media
  // （keyless 代理 URL），站内点位用关联 point.image，都走 ResilientMapImage 候选梯；
  // 站内点位无图时用 /api/google/point-photo 兜底 URL 作为 src（不再直接渲染占位），
  // 并始终作为 fallbackSrc 追加为候选梯最后一档（同源去重，不会重复请求）
  const media = getMedia(item)
  // 静态展示（首页）不能用这个需要登录的兜底：游客会拿到 401
  const pointPhotoSrc =
    item.pointId && !staticMode
      ? `/api/google/point-photo?pointId=${encodeURIComponent(item.pointId)}&maxwidth=400`
      : null
  const image = media?.displayUrl ?? item.point?.image ?? pointPhotoSrc
  const description = item.reason ?? item.note ?? null
  const isExternal = isVisit && !item.pointId && getPlace(item) !== null
  // 免费档不推荐具体餐厅：用餐条目没落到具体地点时给占位提示
  const showMealHint = showRestaurantUpgradeHint && item.type === 'meal' && !item.pointId && getPlace(item) === null
  // 行尾操作：有坐标（进了地图）的条目给「导航」外链；计序点位给「交给规划师调整」
  const navLatLng = pointKey ? itemLatLng(item) : null
  const showRowActions = Boolean(navLatLng) || (seq !== null && Boolean(onComposeDraft))
  // L16：可点选条目键盘可达（role=button + tabIndex + Enter/Space 触发同 onClick）
  const rowSelectable = Boolean(pointKey && onSelectPoint)
  const selectThisPoint = () => {
    if (pointKey && onSelectPoint) onSelectPoint(pointKey)
  }
  return (
    <li
      data-point-id={pointKey ?? undefined}
      data-active={active ? 'true' : undefined}
      onClick={rowSelectable ? selectThisPoint : undefined}
      role={rowSelectable ? 'button' : undefined}
      tabIndex={rowSelectable ? 0 : undefined}
      onKeyDown={
        rowSelectable
          ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                selectThisPoint()
              }
            }
          : undefined
      }
      className={`flex gap-3 px-4 py-3${rowSelectable ? ' cursor-pointer' : ''}${flashing ? ' rounded-xl ring-2 ring-rose-400' : ''}`}
    >
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

      {/* 图片 + 来源角标 + Google 照片署名（ItemThumbnail） */}
      <ItemThumbnail
        image={image}
        alt={item.title}
        fallbackSrc={pointPhotoSrc}
        media={media}
        staticMode={staticMode}
        eager={eagerImage}
        locale={locale}
      />

      {/* 内容区 */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="min-w-0 truncate text-sm font-semibold text-gray-900">{item.title}</span>
          <ScheduleTimeChip item={item} tx={tx} />
          {!isVisit && TYPE_LABEL_KEYS[item.type] ? (
            <span className="shrink-0 rounded bg-gray-50 px-1.5 py-0.5 text-[11px] text-gray-400">
              {tx(TYPE_LABEL_KEYS[item.type]!)}
            </span>
          ) : null}
          {isExternal ? (
            <span className="shrink-0 rounded bg-sky-50 px-1.5 py-0.5 text-[11px] text-sky-600" title={tx('day.googlePlaceTitle')}>
              {tx('day.googlePlace')}
            </span>
          ) : null}
        </div>
        {description ? (
          // AI 生成的推荐理由/备注，过 markdown 管线避免字面 ** 泄漏
          <div className="mt-1 line-clamp-2 text-xs text-gray-500">
            <MarkdownBubble text={description} />
          </div>
        ) : null}
        {showMealHint ? (
          <div className="mt-1.5">
            <TierHint kind="restaurant" locale={locale} />
          </div>
        ) : null}
      </div>

      {/* 行尾操作列：在地图上看（切 tab 高亮）+ 导航外链（Google 地图，新窗口）+ 交给规划师调整（预填聊天输入） */}
      {showRowActions ? (
        <div className="flex shrink-0 flex-col items-center gap-1 self-start pt-0.5">
          {pointKey && onShowOnMap ? (
            <button
              type="button"
              aria-label={tx('day.showOnMapAria', { title: item.title })}
              title={tx('day.showOnMap')}
              onClick={(event) => {
                event.stopPropagation()
                onShowOnMap(pointKey)
              }}
              className="rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-brand-600"
            >
              <MapIcon className="h-3.5 w-3.5" />
            </button>
          ) : null}
          {navLatLng ? (
            <a
              href={buildPointNavigationUrl(navLatLng)}
              target="_blank"
              rel="noopener"
              aria-label={tx('day.navigateAria', { title: item.title })}
              title={tx('day.navigateHere')}
              onClick={(event) => event.stopPropagation()}
              className="rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-brand-600"
            >
              <Navigation className="h-3.5 w-3.5" />
            </a>
          ) : null}
          {seq !== null && onComposeDraft ? (
            <button
              type="button"
              aria-label={tx('day.adjustAria', { title: item.title })}
              title={tx('day.adjust')}
              onClick={(event) => {
                event.stopPropagation()
                onComposeDraft(buildPointAdjustDraft(tx, dayIndex, seq, item.title, snapshotSavedAt))
              }}
              className="rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-brand-600"
            >
              <MessageSquarePlus className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      ) : null}
    </li>
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
  /** 「交给规划师调整」：把预填文案交给聊天输入框（不自动发送）；不传则不渲染调整入口 */
  onComposeDraft?: (text: string) => void
  /** snapshot scope 的保存时间（如 09-01 08:30）：调整文案前缀「基于 … 那版行程，」 */
  snapshotSavedAt?: string | null
  /**
   * 静态展示（首页第二屏）：不预取路网、不显示保存/调整入口、不用需要登录的
   * 点位图兜底接口；导航外链保留。
   */
  static?: boolean
  /** 静态展示时 Day 标签每 5 秒自动轮播，用户交互后停止 */
  autoRotate?: boolean
  /** 档位差异提示开关（设计 §4）：由 PlanPlanner 的单个 useUsage 向下传，缺省不提示 */
  tierHints?: TierHints | null
  locale?: SupportedLocale
}) {
  const {
    planId,
    days,
    scope = 'current',
    onComposeDraft,
    snapshotSavedAt = null,
    static: staticMode = false,
    autoRotate = false,
    tierHints = null,
    locale = 'zh',
  } = props
  const tx = planTextFor(locale)
  const router = useRouter()
  const [view, setView] = useState<'list' | 'map'>('list')
  const [selectedDay, setSelectedDay] = useState<number | null>(null)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [savedRouteBookId, setSavedRouteBookId] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  // marker ↔ 列表条目联动：activePointId 共享给地图高亮；flashPointId 触发 1.5s 高亮环
  const [activePointId, setActivePointId] = useState<string | null>(null)
  const [flashPointId, setFlashPointId] = useState<string | null>(null)
  // M7：途经点上限首屏恒按桌面 9 渲染（避免 hydration mismatch），
  // 挂载后才按 matchMedia 修正为移动端 3
  const [maxWaypoints, setMaxWaypoints] = useState(9)
  const listRef = useRef<HTMLOListElement>(null)
  // 天数很多时 tab 横向溢出；滚动条全站隐藏后桌面鼠标靠拖拽访问
  const dayTabsDrag = useDragToScroll()

  useEffect(() => {
    setMaxWaypoints(defaultMaxNavigationWaypoints())
  }, [])

  // 后台预取各天真实道路路线（不阻塞渲染）：切到地图 tab 时命中模块级缓存直接展示，
  // 避免"切 tab 才开始请求"造成的明显等待；同 signature 请求在 fetchRouteGeometry 内去重。
  // 已有 provider 折线（estimate_travel 落库）的天优先用权威几何，不再预取通用路网。
  useEffect(() => {
    // 静态展示不预取路网（首页不应为展示计划发请求）
    if (staticMode) return
    for (const day of days) {
      const points = dayRoutePoints(day)
      if (points.length < 2) continue
      // R2：逐段拼线后仍无任何真实折线的天才需要通用路网兜底
      if (composeDayRoute(points, day.items).coverage !== 'none') continue
      void fetchRouteGeometry(planId, routeSignature(points), dayTravelMode(day.items))
    }
  }, [planId, days, staticMode])

  const active = days.find((d) => d.dayIndex === selectedDay) ?? days[0]

  // 首页展示：Day 标签自动轮播，任何手动交互后停止
  const autoRotation = useDayAutoRotate({
    enabled: autoRotate,
    dayIndexes: days.map((d) => d.dayIndex),
    onRotate: setSelectedDay,
  })

  // 切天重置联动状态
  useEffect(() => {
    setActivePointId(null)
    setFlashPointId(null)
  }, [active?.dayIndex])

  // L17：高亮环定时器与 tab 无关——只要 flashPointId 在场就 1.5 秒后清除；
  // 切天/卸载由 effect cleanup 清定时器（切天另有重置置 null）
  useEffect(() => {
    if (!flashPointId) return
    const timer = setTimeout(() => setFlashPointId(null), 1500)
    return () => clearTimeout(timer)
  }, [flashPointId])

  // marker/「查看条目」联动：列表 tab 下滚动到对应条目（高亮环由上面的定时器收口）
  useEffect(() => {
    if (!flashPointId || view !== 'list') return
    const rows = listRef.current?.querySelectorAll('[data-point-id]') ?? []
    for (const row of rows) {
      if (row.getAttribute('data-point-id') === flashPointId) {
        const el = row as HTMLElement
        if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' })
      }
    }
  }, [flashPointId, view])

  // M3：marker 点选只设高亮（不切 tab——Popup 在地图上展示，「查看条目」才切回列表）
  function handlePointSelect(id: string) {
    setActivePointId(id)
  }

  // Popup「查看条目」：切回列表、滚动到对应条目并闪烁 1.5 秒高亮环
  function handleRequestShowItem(id: string) {
    setActivePointId(id)
    setFlashPointId(id)
    setView('list')
  }

  // 条目行尾「在地图上看」：切到地图 tab，activePointId 生效（放大/easeTo/自动 Popup）
  function handleShowOnMap(id: string) {
    setActivePointId(id)
    setView('map')
  }

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
        setSaveError(data?.error ?? tx('day.saveFailed'))
      }
    } catch {
      setSaveState('idle')
      setSaveError(tx('day.networkError'))
    }
  }

  if (!days.length) {
    return (
      <div className="rounded-2xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">
        {tx('day.empty')}
      </div>
    )
  }

  // 渲染期时间兜底（M3 修订）：历史数据无 schedule 也推导出具体时钟时间；
  // 再按结构化时间防御性二次排序（不信任插入顺序，服务端已排过是双保险）
  const renderedItems = ensureDayScheduleForRender(active.items)
  const sortedItems = sortItemsBySchedule(renderedItems)
  // 列表 key/联动 id 不再用 item.id（每次保存 deleteMany+createMany 后 id 全换，
  // 轮询拿到新计划会全量重挂载、图片重新请求）：改用内容签名，
  // 同一天内重复签名追加 #序号；与地图 marker 的 data-point-id 同值
  const itemKeys = dayItemContentKeys(sortedItems)

  return (
    <div ref={autoRotation.containerRef} className="rounded-2xl border border-gray-200 bg-white shadow-sm">
      {/* header：列表/地图切换 + 保存到我的地图 */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-4 py-3">
        <div className="inline-flex rounded-full bg-gray-100 p-0.5 text-xs">
          {(
            [
              { key: 'list', textKey: 'day.tabList', Icon: List },
              { key: 'map', textKey: 'day.tabMap', Icon: MapIcon },
            ] as const
          ).map(({ key, textKey, Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                autoRotation.stop()
                setView(key)
              }}
              className={
                view === key
                  ? 'inline-flex items-center gap-1 rounded-full bg-white px-3 py-1 font-semibold text-gray-900 shadow-sm'
                  : 'inline-flex items-center gap-1 rounded-full px-3 py-1 text-gray-500'
              }
            >
              <Icon className="h-3.5 w-3.5" />
              {tx(textKey)}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <DaysLimitHint dayCount={days.length} maxDays={tierHints?.maxDays} locale={locale} />
          {staticMode ? null : scope === 'snapshot' ? (
            <span className="text-xs text-gray-400">{tx('day.snapshotReadonly')}</span>
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
                {saveState === 'saved' ? tx('day.savedViewMap') : tx('day.saveToMyMap')}
              </button>
            </>
          )}
        </div>
      </div>

      {/* 天数 tab（key 用 dayIndex：每次保存 id 全换，内容稳定才不重挂载） */}
      <div ref={dayTabsDrag.ref} {...dayTabsDrag.handlers} className={`flex gap-2 overflow-x-auto px-4 pt-3 ${dayTabsDrag.cursorClass}`}>
        {days.map((day) => {
          const date = formatDayDate(day.date)
          return (
            <button
              key={day.dayIndex}
              type="button"
              onClick={() => {
                autoRotation.stop()
                setSelectedDay(day.dayIndex)
              }}
              className={
                day.dayIndex === active.dayIndex
                  ? 'shrink-0 rounded-full bg-brand-600 px-4 py-1.5 text-sm font-semibold text-white'
                  : 'shrink-0 rounded-full border border-gray-200 bg-white px-4 py-1.5 text-sm text-gray-600 hover:border-brand-300'
              }
            >
              {tx('day.dayLabel', { day: day.dayIndex })}
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

      {/* Day 头部操作条：整日导航（多段时列出各段）+ 交给规划师调整；两种 scope 都显示 */}
      {(() => {
        const dayNavUrls = buildDayNavigationUrls(dayRoutePoints(active), { maxWaypoints })
        if (!dayNavUrls.length && !onComposeDraft) return null
        return (
          <div className="flex flex-wrap items-center gap-2 px-4 pt-2">
            {dayNavUrls.length === 1 ? (
              <a
                href={dayNavUrls[0]}
                target="_blank"
                rel="noopener"
                className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-3 py-1 text-xs text-gray-600 hover:border-brand-300 hover:text-brand-600"
              >
                <Navigation className="h-3 w-3" />
                {tx('day.dayNav')}
              </a>
            ) : dayNavUrls.length > 1 ? (
              <details className="relative">
                <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-full border border-gray-200 bg-white px-3 py-1 text-xs text-gray-600 hover:border-brand-300 hover:text-brand-600">
                  <Navigation className="h-3 w-3" />
                  {tx('day.dayNavSegments', { count: dayNavUrls.length })}
                </summary>
                <div className="absolute left-0 z-10 mt-1 flex min-w-28 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white py-1 shadow-lg">
                  {dayNavUrls.map((url, index) => (
                    <a
                      key={index}
                      href={url}
                      target="_blank"
                      rel="noopener"
                      className="px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50 hover:text-brand-600"
                    >
                      {tx('day.segment', { index: index + 1 })}
                    </a>
                  ))}
                </div>
              </details>
            ) : null}
            {onComposeDraft ? (
              <button
                type="button"
                onClick={() => onComposeDraft(buildDayAdjustDraft(tx, active.dayIndex, snapshotSavedAt))}
                className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-3 py-1 text-xs text-gray-600 hover:border-brand-300 hover:text-brand-600"
              >
                <MessageSquarePlus className="h-3 w-3" />
                {tx('day.adjustDay')}
              </button>
            ) : null}
          </div>
        )
      })()}

      {view === 'list' ? (
        <ol ref={listRef} className="max-h-96 overflow-y-auto py-1">
          {(() => {
            let seq = 0
            return sortedItems.map((item, idx) => {
              const itemKey = itemKeys[idx]!
              if (item.type === 'transit') {
                // 起终点坐标：取前后最近的带坐标条目，供无 mapsUrl 的兜底载荷拼
                // Google 导航链接（"拿不到方案就告诉用户去哪查"）
                let origin: { lat: number; lng: number } | null = null
                for (let j = idx - 1; j >= 0; j--) {
                  const latLng = itemLatLng(sortedItems[j]!)
                  if (latLng) {
                    origin = latLng
                    break
                  }
                }
                let destination: { lat: number; lng: number } | null = null
                for (let j = idx + 1; j < sortedItems.length; j++) {
                  const latLng = itemLatLng(sortedItems[j]!)
                  if (latLng) {
                    destination = latLng
                    break
                  }
                }
                return (
                  <TransitConnector
                    key={itemKey}
                    item={item}
                    origin={origin}
                    destination={destination}
                    showEstimateUpgradeHint={tierHints?.transitEstimateOnly ?? false}
                    locale={locale}
                  />
                )
              }
              const isVisit = isNumberedVisitItem(item)
              if (isVisit) seq += 1
              // 与地图 marker 联动的条目：有坐标、进了 dayRoutePoints 的才给 pointKey
              const pointKey = isRoutablePointItem(item) && itemLatLng(item) ? itemKey : null
              return (
                <TimelineCardRow
                  key={itemKey}
                  item={item}
                  seq={isVisit ? seq : null}
                  showLine={idx < sortedItems.length - 1}
                  pointKey={pointKey}
                  active={pointKey !== null && pointKey === activePointId}
                  flashing={pointKey !== null && pointKey === flashPointId}
                  onSelectPoint={pointKey ? setActivePointId : undefined}
                  onShowOnMap={pointKey ? handleShowOnMap : undefined}
                  dayIndex={active.dayIndex}
                  snapshotSavedAt={snapshotSavedAt}
                  onComposeDraft={onComposeDraft}
                  staticMode={staticMode}
                  eagerImage={idx < EAGER_IMAGE_COUNT}
                  showRestaurantUpgradeHint={tierHints?.restaurantsLocked ?? false}
                  locale={locale}
                />
              )
            })
          })()}
        </ol>
      ) : (
        <div className="pt-3">
          <DayMap
            planId={planId}
            static={staticMode}
            day={active}
            activePointId={activePointId}
            onPointSelect={handlePointSelect}
            onRequestShowItem={handleRequestShowItem}
            tierHints={tierHints}
            locale={locale}
          />
        </div>
      )}
    </div>
  )
}

// ---------- daymap 聊天交付物包装 ----------

/**
 * 聊天时间线里的 daymap 交付物：渲染 save_plan_days 成功那一刻的不可变
 * 快照（DayCards scope=snapshot，只读）。每个实例的 Day tab 状态独立，
 * 互不影响；路线优先用快照内的 provider 几何，缺失时走现有路线 API
 * 缓存与失败重试（DayCards/DayMap 既有行为）。
 *
 * 保存时间标签走 useClientFormattedTime：首帧空串（服务端 UTC 与浏览器
 * 本地时区格式化不同，直接算会触发 React #418 文本水合不一致），effect
 * 后填本地时区 MM-DD HH:mm；「交给规划师调整」前缀在点击时取值，
 * 此时 state 已是本地格式。
 */
export function DaymapCard(props: {
  planId: string
  daymap: DaymapMessagePayload
  onComposeDraft?: (text: string) => void
  /** 静态展示（首页第二屏）：不发请求、不显示快照抬头与保存/调整入口 */
  static?: boolean
  autoRotate?: boolean
  tierHints?: TierHints | null
  locale?: SupportedLocale
}) {
  const { daymap, static: staticMode = false, autoRotate = false, locale = 'zh' } = props
  const savedAtLabel = useClientFormattedTime(daymap.savedAt, locale)
  return (
    <div data-daymap-revision={daymap.revisionId} className="pt-1">
      {staticMode ? null : (
        <div className="flex items-center gap-1.5 px-1 pb-1.5 text-xs text-gray-400">
          <MapIcon className="h-3.5 w-3.5 shrink-0" />
          <span>{planTextFor(locale)('day.snapshotSaved')}</span>
          {savedAtLabel ? <span className="tabular-nums">{savedAtLabel}</span> : null}
        </div>
      )}
      <DayCards
        planId={props.planId}
        days={daymap.days}
        scope="snapshot"
        snapshotSavedAt={savedAtLabel || null}
        onComposeDraft={props.onComposeDraft}
        static={staticMode}
        autoRotate={autoRotate}
        tierHints={props.tierHints ?? null}
        locale={locale}
      />
    </div>
  )
}
