'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { List, Loader2, Map as MapIcon, MapPin, MessageSquarePlus, Navigation } from 'lucide-react'
import ResilientMapImage from '@/components/map/ResilientMapImage'
import { useDragToScroll } from '@/lib/hooks/useDragToScroll'
import { MarkdownBubble } from './MarkdownBubble'
import { TransitConnector } from './TransitConnector'
import { DayMap } from './DayMap'
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
import { useClientFormattedTime } from '../hooks/useClientFormattedTime'
import type { DaymapMessagePayload, TripPlanDayView, TripPlanItemView } from '@/lib/tripPlan/view'

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

function formatDayDate(date: string | null): string | null {
  if (!date) return null
  // ISO 串直接切月/日，避免时区换算偏移
  const match = /^\d{4}-(\d{2})-(\d{2})/.exec(date)
  if (!match) return null
  return `${Number(match[1])}/${Number(match[2])}`
}

// 「交给规划师调整」预填文案（§0）：点位级带天数/序号/标题；整日级只带天数；
// 历史快照额外前缀「基于 {savedAt} 那版行程，」（快照不可悄悄修改，只做预填转述）
function snapshotDraftPrefix(snapshotSavedAt?: string | null): string {
  return snapshotSavedAt ? `基于 ${snapshotSavedAt} 那版行程，` : ''
}

function buildPointAdjustDraft(day: number, seq: number, title: string, snapshotSavedAt?: string | null): string {
  return `${snapshotDraftPrefix(snapshotSavedAt)}请调整第 ${day} 天第 ${seq} 个点位「${title}」：`
}

function buildDayAdjustDraft(day: number, snapshotSavedAt?: string | null): string {
  return `${snapshotDraftPrefix(snapshotSavedAt)}请调整第 ${day} 天的安排：`
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
  } = props
  // 计序口径（M3 修订）：type='point'（含历史缺坐标数据）与带 payload.place 的
  // 外部地点条目（point/attraction）都是完整行程点——计序号、展示媒体图；
  // 地图/路线仅纳入有坐标的点（dayRoutePoints 另行过滤）
  const isVisit = isNumberedVisitItem(item)
  // 图片阶梯与 /map 一致：外部地点（含 attraction）优先 payload.media
  // （keyless 代理 URL），站内点位用关联 point.image，都走 ResilientMapImage 候选梯；
  // 站内点位无图时用 /api/google/point-photo 兜底 URL 作为 src（不再直接渲染占位），
  // 并始终作为 fallbackSrc 追加为候选梯最后一档（同源去重，不会重复请求）
  const media = getMedia(item)
  const pointPhotoSrc = item.pointId
    ? `/api/google/point-photo?pointId=${encodeURIComponent(item.pointId)}&maxwidth=400`
    : null
  const image = media?.displayUrl ?? item.point?.image ?? pointPhotoSrc
  const description = item.reason ?? item.note ?? null
  const isExternal = isVisit && !item.pointId && getPlace(item) !== null
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

      {/* 图片：无图 → 渐变占位 + pin 图标；只要有媒体图（payload.media 或 point.image）就渲染——非计序条目（free/
          参考类 lodging、meal 等）有图也显示，仅计序规则不变；neighbor 来源图右下角加极小"参考"角标。
          点位图复用地图的 ResilientMapImage（直连失败自动走 /api/anitabi/image-render 代理重试）；
          80–96px 小卡用 point-thumbnail（h160 缩略图变体，R2 已镜像命中率高），不走 point 的 w=640 档 */}
      <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl sm:h-24 sm:w-24">
        {image ? (
          <ResilientMapImage
            src={image}
            alt={item.title}
            kind="point-thumbnail"
            className="h-full w-full object-cover"
            loading="lazy"
            fallbackSrc={pointPhotoSrc}
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
        {media?.source === 'neighbor' ? (
          // 邻近条目借用图：右下角极小"参考"角标提示图片来源，其他来源不加
          <span
            title="借用邻近条目的图片"
            className="absolute bottom-1 right-1 rounded bg-black/55 px-1 py-0.5 text-[10px] leading-none text-white/95"
          >
            参考
          </span>
        ) : null}
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

      {/* 行尾操作列：在地图上看（切 tab 高亮）+ 导航外链（Google 地图，新窗口）+ 交给规划师调整（预填聊天输入） */}
      {showRowActions ? (
        <div className="flex shrink-0 flex-col items-center gap-1 self-start pt-0.5">
          {pointKey && onShowOnMap ? (
            <button
              type="button"
              aria-label={`在地图上看：${item.title}`}
              title="在地图上看"
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
              aria-label={`导航到${item.title}`}
              title="在 Google 地图导航到这里"
              onClick={(event) => event.stopPropagation()}
              className="rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-brand-600"
            >
              <Navigation className="h-3.5 w-3.5" />
            </a>
          ) : null}
          {seq !== null && onComposeDraft ? (
            <button
              type="button"
              aria-label={`交给规划师调整：${item.title}`}
              title="交给规划师调整"
              onClick={(event) => {
                event.stopPropagation()
                onComposeDraft(buildPointAdjustDraft(dayIndex, seq, item.title, snapshotSavedAt))
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
}) {
  const { planId, days, scope = 'current', onComposeDraft, snapshotSavedAt = null } = props
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
    for (const day of days) {
      const points = dayRoutePoints(day)
      if (points.length < 2) continue
      // R2：逐段拼线后仍无任何真实折线的天才需要通用路网兜底
      if (composeDayRoute(points, day.items).coverage !== 'none') continue
      void fetchRouteGeometry(planId, routeSignature(points), dayTravelMode(day.items))
    }
  }, [planId, days])

  const active = days.find((d) => d.dayIndex === selectedDay) ?? days[0]

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

  // 渲染期时间兜底（M3 修订）：历史数据无 schedule 也推导出具体时钟时间；
  // 再按结构化时间防御性二次排序（不信任插入顺序，服务端已排过是双保险）
  const renderedItems = ensureDayScheduleForRender(active.items)
  const sortedItems = sortItemsBySchedule(renderedItems)
  // 列表 key/联动 id 不再用 item.id（每次保存 deleteMany+createMany 后 id 全换，
  // 轮询拿到新计划会全量重挂载、图片重新请求）：改用内容签名，
  // 同一天内重复签名追加 #序号；与地图 marker 的 data-point-id 同值
  const itemKeys = dayItemContentKeys(sortedItems)

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

      {/* 天数 tab（key 用 dayIndex：每次保存 id 全换，内容稳定才不重挂载） */}
      <div ref={dayTabsDrag.ref} {...dayTabsDrag.handlers} className={`flex gap-2 overflow-x-auto px-4 pt-3 ${dayTabsDrag.cursorClass}`}>
        {days.map((day) => {
          const date = formatDayDate(day.date)
          return (
            <button
              key={day.dayIndex}
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
                整日导航
              </a>
            ) : dayNavUrls.length > 1 ? (
              <details className="relative">
                <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-full border border-gray-200 bg-white px-3 py-1 text-xs text-gray-600 hover:border-brand-300 hover:text-brand-600">
                  <Navigation className="h-3 w-3" />
                  整日导航（{dayNavUrls.length} 段）
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
                      第 {index + 1} 段
                    </a>
                  ))}
                </div>
              </details>
            ) : null}
            {onComposeDraft ? (
              <button
                type="button"
                onClick={() => onComposeDraft(buildDayAdjustDraft(active.dayIndex, snapshotSavedAt))}
                className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-3 py-1 text-xs text-gray-600 hover:border-brand-300 hover:text-brand-600"
              >
                <MessageSquarePlus className="h-3 w-3" />
                交给规划师调整这一天
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
                return <TransitConnector key={itemKey} item={item} origin={origin} destination={destination} />
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
                />
              )
            })
          })()}
        </ol>
      ) : (
        <div className="pt-3">
          <DayMap
            planId={planId}
            day={active}
            activePointId={activePointId}
            onPointSelect={handlePointSelect}
            onRequestShowItem={handleRequestShowItem}
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
export function DaymapCard(props: { planId: string; daymap: DaymapMessagePayload; onComposeDraft?: (text: string) => void }) {
  const { daymap } = props
  const savedAtLabel = useClientFormattedTime(daymap.savedAt)
  return (
    <div data-daymap-revision={daymap.revisionId} className="pt-1">
      <div className="flex items-center gap-1.5 px-1 pb-1.5 text-xs text-gray-400">
        <MapIcon className="h-3.5 w-3.5 shrink-0" />
        <span>行程快照 · 已保存</span>
        {savedAtLabel ? <span className="tabular-nums">{savedAtLabel}</span> : null}
      </div>
      <DayCards
        planId={props.planId}
        days={daymap.days}
        scope="snapshot"
        snapshotSavedAt={savedAtLabel || null}
        onComposeDraft={props.onComposeDraft}
      />
    </div>
  )
}
