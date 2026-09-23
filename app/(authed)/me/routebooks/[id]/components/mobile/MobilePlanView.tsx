'use client'

import { useMemo, useRef, useState, type ReactNode } from 'react'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { ArrowLeftRight, CalendarDays, ChevronRight, Inbox, StickyNote, Trash2, X } from 'lucide-react'
import type { SupportedLocale } from '@/lib/i18n/types'
import type { DayLegsResult, DayRecord, ItemRecord, PointPreview, RouteBookDetail } from '../../types'
import { computeVisitOrder, dayLabel, itemDragId } from '../../utils'
import type { UpdateItemInput } from '../../hooks/useTripData'
import { TimelineItem } from '../TimelineItem'
import { LegConnector } from '../LegConnector'
import { tr } from '../../../i18n'

/** 左滑露出操作的阈值（px） */
const SWIPE_OPEN_THRESHOLD = 80
/** 露出后操作区宽度（px）：移到… + 移除 */
const ACTIONS_WIDTH = 172
/** 超过这个时间（ms）还没动 → 视为长按拖拽（dnd-kit TouchSensor delay:200），不再判定为滑动 */
const LONG_PRESS_MS = 200

type SwipeState = {
  pointerId: number
  startX: number
  startY: number
  startTime: number
  swiping: boolean
  dead: boolean
}

/** 「移到…」底部 sheet（fixed 定位，避免被滑动容器的 overflow 裁掉） */
function MoveToSheet({
  item,
  days,
  open,
  onMove,
  onClose,
  locale,
}: {
  item: ItemRecord
  days: DayRecord[]
  open: boolean
  onMove: (targetDayId: string | null) => void
  onClose: () => void
  locale: SupportedLocale
}) {
  if (!open) return null
  const sorted = [...days].sort((a, b) => a.dayIndex - b.dayIndex)
  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center">
      <button
        type="button"
        aria-label={tr('routebook.common.close', locale)}
        className="absolute inset-0 bg-slate-950/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative mb-0 w-full max-w-md rounded-t-[28px] border border-pink-100 bg-white p-4 pb-8 shadow-[0_-18px_44px_-24px_rgba(15,23,42,0.45)]">
        <div className="mb-3 flex items-center justify-between px-1">
          <h3 className="text-base font-semibold text-slate-900">{tr('routebook.common.moveTo', locale)}</h3>
          <button
            type="button"
            aria-label={tr('routebook.common.close', locale)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-pink-50 hover:text-slate-600"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[50dvh] space-y-2 overflow-y-auto">
          {sorted.map((day) => (
            <button
              key={day.id}
              type="button"
              disabled={day.id === item.dayId}
              className="flex w-full items-center gap-3 rounded-2xl border border-pink-100/80 bg-white px-4 py-3 text-left transition hover:border-brand-200 hover:bg-pink-50/60 disabled:cursor-not-allowed disabled:opacity-45"
              onClick={() => {
                onClose()
                onMove(day.id)
              }}
            >
              <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-pink-50 text-brand-500">
                <CalendarDays className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1 text-sm font-semibold text-slate-900">
                {dayLabel(day, day.dayIndex, locale)}
              </span>
            </button>
          ))}
          <button
            type="button"
            disabled={item.dayId === null}
            className="flex w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-45"
            onClick={() => {
              onClose()
              onMove(null)
            }}
          >
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
              <Inbox className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1 text-sm font-semibold text-slate-700">
              {tr('routebook.common.unassigned', locale)}
            </span>
          </button>
        </div>
      </div>
    </div>
  )
}

/** 单条左滑容器：左滑 ≥80px 露出「移到… / 移除」；与长按拖拽共存（先动者胜）。
 *  展开态由父级受控：同一时间只允许一行展开 */
function SwipeableActions({
  children,
  item,
  days,
  open,
  onOpenChange,
  onMove,
  onDelete,
  locale,
}: {
  children: ReactNode
  item: ItemRecord
  days: DayRecord[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onMove: (targetDayId: string | null) => void
  onDelete: () => void
  locale: SupportedLocale
}) {
  const [dragOffset, setDragOffset] = useState<number | null>(null)
  const [moveSheetOpen, setMoveSheetOpen] = useState(false)
  const stateRef = useRef<SwipeState | null>(null)
  // 刚结束一次滑动：吞掉随之而来的 click（避免滑回时顺手触发条目点击）
  const suppressClickRef = useRef(false)

  const offset = dragOffset ?? (open ? -ACTIONS_WIDTH : 0)

  const close = () => {
    onOpenChange(false)
    setDragOffset(null)
  }

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    // 新手势开始：上一次滑动若没有产生 click，这里清掉吞 click 标记
    suppressClickRef.current = false
    if (event.pointerType === 'mouse') return
    stateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startTime: Date.now(),
      swiping: false,
      dead: false,
    }
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = stateRef.current
    if (!state || state.dead || event.pointerId !== state.pointerId) return
    const dx = event.clientX - state.startX
    const dy = event.clientY - state.startY
    if (!state.swiping) {
      // 长按已开始（dnd 接管）→ 本次手势不再做滑动判定
      if (Date.now() - state.startTime > LONG_PRESS_MS) {
        state.dead = true
        return
      }
      // 垂直主导 → 让位给页面滚动
      if (Math.abs(dy) > 8 && Math.abs(dy) >= Math.abs(dx)) {
        state.dead = true
        return
      }
      if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) {
        state.swiping = true
      } else {
        return
      }
    }
    const base = open ? -ACTIONS_WIDTH : 0
    setDragOffset(Math.max(-ACTIONS_WIDTH, Math.min(0, base + dx)))
  }

  const handlePointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = stateRef.current
    stateRef.current = null
    if (!state || !state.swiping || event.pointerId !== state.pointerId) return
    suppressClickRef.current = true
    const final = dragOffset ?? 0
    if (open) {
      // 已开：往回滑过一半才关闭
      if (final > -ACTIONS_WIDTH / 2) onOpenChange(false)
    } else if (final <= -SWIPE_OPEN_THRESHOLD) {
      onOpenChange(true)
    }
    setDragOffset(null)
  }

  // 展开时点内容区 = 收回（捕获阶段拦截，不触发条目自身的点击）；
  // 不再盖一层遮罩按钮——遮罩会拦住反向滑回的 pointer 事件
  const handleClickCapture = (event: React.MouseEvent<HTMLDivElement>) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      event.preventDefault()
      event.stopPropagation()
      return
    }
    if (!open) return
    event.preventDefault()
    event.stopPropagation()
    close()
  }

  return (
    <div className="relative overflow-hidden rounded-2xl" data-testid="swipeable-item" data-open={open}>
      {/* 操作层（右侧露出） */}
      <div className="absolute inset-y-1 right-1 flex items-stretch gap-1" aria-hidden={!open}>
        <button
          type="button"
          tabIndex={open ? 0 : -1}
          className="inline-flex w-20 items-center justify-center gap-1 rounded-xl bg-slate-700 text-xs font-semibold text-white"
          onClick={() => setMoveSheetOpen(true)}
        >
          <ArrowLeftRight className="h-3.5 w-3.5" />
          {tr('routebook.common.moveTo', locale)}
        </button>
        <button
          type="button"
          tabIndex={open ? 0 : -1}
          className="inline-flex w-20 items-center justify-center gap-1 rounded-xl bg-rose-500 text-xs font-semibold text-white"
          onClick={() => {
            close()
            onDelete()
          }}
        >
          <Trash2 className="h-3.5 w-3.5" />
          {tr('routebook.mobile.remove', locale)}
        </button>
      </div>
      {/* 内容层：pan-y 让浏览器只接管纵向滚动，横向手势留给左滑（否则会发 pointercancel） */}
      <div
        data-testid="swipeable-content"
        className={`relative ${dragOffset === null ? 'transition-transform duration-150 ease-out' : ''}`}
        style={{ transform: offset === 0 ? undefined : `translateX(${offset}px)`, touchAction: 'pan-y' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        onClickCapture={handleClickCapture}
      >
        {children}
      </div>
      <MoveToSheet
        item={item}
        days={days}
        open={moveSheetOpen}
        locale={locale}
        onClose={() => {
          setMoveSheetOpen(false)
          close()
        }}
        onMove={onMove}
      />
    </div>
  )
}

export type MobilePlanViewProps = {
  /** day = 当前天时间线；unassigned = 未安排时间线；all = 各天折叠摘要（只读 + 点击进入） */
  mode: 'day' | 'unassigned' | 'all'
  detail: RouteBookDetail
  days: DayRecord[]
  /** mode=day 的当前天 */
  day?: DayRecord | null
  /** 当前列表条目（mode=day 为当天条目，mode=unassigned 为未安排条目，已按 sortOrder 排序） */
  items: ItemRecord[]
  getPointPreview: (pointId: string) => PointPreview
  legs?: DayLegsResult
  legsFailed?: boolean
  onRetryLegs?: () => void
  onUpdateItem: (itemId: string, data: UpdateItemInput) => void
  onDeleteItem: (itemId: string) => void
  onMoveItem: (itemId: string, targetDayId: string | null) => void
  onOpenItemDetail?: (itemId: string) => void
  onEditNote?: (itemId: string) => void
  onAddNote?: (dayId: string) => void
  /** mode=all：点击某天摘要进入该天 */
  onEnterDay?: (dayId: string) => void
  locale?: SupportedLocale
}

/** 移动端计划视图：当前天 / 未安排 时间线（左滑操作 + 长按排序），或「全部」各天摘要 */
export function MobilePlanView({
  mode,
  detail,
  days,
  day = null,
  items,
  getPointPreview,
  legs,
  legsFailed = false,
  onRetryLegs,
  onUpdateItem,
  onDeleteItem,
  onMoveItem,
  onOpenItemDetail,
  onEditNote,
  onAddNote,
  onEnterDay,
  locale = 'zh',
}: MobilePlanViewProps) {
  const legByToId = useMemo(() => {
    const map = new Map<string, DayLegsResult['legs'][number]>()
    for (const leg of legs?.legs ?? []) map.set(leg.toId, leg)
    return map
  }, [legs])

  const staleIds = useMemo(() => new Set(legs?.staleTransitItemIds ?? []), [legs])
  // 同一时间只允许一行左滑展开
  const [openRowId, setOpenRowId] = useState<string | null>(null)

  const visitOrder = useMemo(
    () => computeVisitOrder(items, detail.places, getPointPreview),
    [items, detail.places, getPointPreview]
  )

  if (mode === 'all') {
    const sortedDays = [...days].sort((a, b) => a.dayIndex - b.dayIndex)
    return (
      <section aria-label={tr('routebook.mobile.allDays', locale)} className="space-y-2">
        <h3 className="px-1 text-xs font-semibold uppercase tracking-wider text-slate-400">
          {tr('routebook.mobile.allDays', locale)}
        </h3>
        {sortedDays.map((row) => {
          const stopCount = detail.items.filter(
            (item) => item.dayId === row.id && (item.kind === 'point' || item.kind === 'place')
          ).length
          return (
            <button
              key={row.id}
              type="button"
              className="flex w-full items-center gap-3 rounded-[24px] border border-pink-100/80 bg-white px-4 py-3 text-left shadow-[0_10px_22px_-20px_rgba(15,23,42,0.4)] transition hover:border-brand-200"
              onClick={() => onEnterDay?.(row.id)}
            >
              <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-pink-50 text-brand-500">
                <CalendarDays className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-slate-900">{dayLabel(row, row.dayIndex, locale)}</span>
                <span className="mt-0.5 block truncate text-[11px] text-slate-400">
                  {row.title ? `${row.title} · ` : ''}
                  {tr('routebook.common.stopCount', locale, { n: stopCount })}
                </span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" />
            </button>
          )
        })}
      </section>
    )
  }

  const isUnassigned = mode === 'unassigned'

  return (
    <section
      aria-label={
        isUnassigned
          ? tr('routebook.common.unassigned', locale)
          : dayLabel(day ?? { date: null }, day?.dayIndex ?? 0, locale)
      }
      className="space-y-1.5"
    >
      {isUnassigned ? (
        <div className="flex items-center gap-2 px-1.5 pb-1">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
            <Inbox className="h-4 w-4" />
          </span>
          <div>
            <div className="text-sm font-semibold text-slate-700">{tr('routebook.common.unassigned', locale)}</div>
            <div className="text-[11px] text-slate-400">
              {tr('routebook.sidebar.unassignedCount', locale, { n: items.length })}
            </div>
          </div>
        </div>
      ) : null}

      {legsFailed && !isUnassigned ? (
        <div className="flex items-stretch gap-3 py-0.5 pl-5">
          <div className="flex w-5 justify-center">
            <span className="w-px bg-rose-200" />
          </div>
          <button
            type="button"
            className="my-1 inline-flex items-center gap-1.5 rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-[11px] font-medium text-rose-600 transition hover:bg-rose-100"
            onClick={onRetryLegs}
          >
            {tr('routebook.detail.legsFailed', locale)} · {tr('routebook.common.retry', locale)}
          </button>
        </div>
      ) : null}

      <SortableContext items={items.map((item) => itemDragId(item.id))} strategy={verticalListSortingStrategy}>
        {items.map((item) => (
          <div key={item.id}>
            {!isUnassigned && legByToId.has(item.id) ? (
              <LegConnector
                leg={legByToId.get(item.id) ?? null}
                routeVisible
                itemLegMode={item.legMode}
                onChangeLegMode={(modeValue) => onUpdateItem(item.id, { legMode: modeValue })}
                locale={locale}
              />
            ) : null}
            <SwipeableActions
              item={item}
              days={days}
              locale={locale}
              open={openRowId === item.id}
              onOpenChange={(next) => setOpenRowId((prev) => (next ? item.id : prev === item.id ? null : prev))}
              onMove={(target) => onMoveItem(item.id, target)}
              onDelete={() => onDeleteItem(item.id)}
            >
              <TimelineItem
                item={item}
                preview={item.pointId ? getPointPreview(item.pointId) : null}
                places={detail.places}
                days={days}
                staleTransit={staleIds.has(item.id)}
                seq={visitOrder.get(item.id)}
                mobileDrag
                hideLockButton
                onUpdate={(data) => onUpdateItem(item.id, data)}
                onDelete={() => onDeleteItem(item.id)}
                onMoveItem={(targetDayId) => onMoveItem(item.id, targetDayId)}
                onEditNote={item.kind === 'note' && onEditNote ? () => onEditNote(item.id) : undefined}
                onOpenDetail={
                  (item.kind === 'point' || item.kind === 'place') && onOpenItemDetail
                    ? () => onOpenItemDetail(item.id)
                    : undefined
                }
                locale={locale}
              />
            </SwipeableActions>
          </div>
        ))}
        {items.length === 0 ? (
          <div className="rounded-xl border border-dashed border-pink-200 bg-pink-50/40 px-4 py-5 text-center text-xs text-slate-400">
            {isUnassigned ? tr('routebook.sidebar.unassignedEmpty', locale) : tr('routebook.mobile.emptyDay', locale)}
          </div>
        ) : null}
      </SortableContext>

      {!isUnassigned && day && onAddNote ? (
        <button
          type="button"
          className="mt-1 inline-flex min-h-8 items-center gap-1 rounded-xl px-2.5 text-xs font-medium text-slate-500 transition hover:bg-pink-100/60 hover:text-slate-700"
          onClick={() => onAddNote(day.id)}
        >
          <StickyNote className="h-3.5 w-3.5 text-brand-400" />
          {tr('routebook.note.add', locale)}
        </button>
      ) : null}
    </section>
  )
}
