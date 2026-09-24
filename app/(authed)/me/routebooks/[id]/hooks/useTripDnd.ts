'use client'

import { useCallback, useState, type PointerEvent as ReactPointerEvent } from 'react'
import {
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type CollisionDetection,
  type DragStartEvent,
  type PointerSensorOptions,
} from '@dnd-kit/core'
import { arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import type { ItemRecord, PointPoolItem } from '../types'
import {
  DAY_DROP_PREFIX,
  DAY_ITEM_LIMIT,
  ITEM_DND_PREFIX,
  MARKER_DND_PREFIX,
  POOL_DND_PREFIX,
  UNASSIGNED_DROP_ID,
} from '../types'
import { parseDayDropId, parseDragRecordId } from '../utils'

type AddItemFn = (
  dayId: string | null,
  input: { kind: 'point'; pointId: string },
  index?: number
) => Promise<string | null>

type UseTripDndOptions = {
  items: ItemRecord[]
  pointPoolItems: PointPoolItem[]
  reorder: (targetDayId: string | null, orderedIds: string[]) => Promise<boolean>
  addItem: AddItemFn
  /** 目标天 point/place 已满（25 条上限）时提示；未安排区不限 */
  onLimitBlocked?: (dayId: string) => void
}

/** 只响应鼠标/笔的 PointerSensor：触屏的 pointerdown 交给 TouchSensor（长按 200ms），
 *  否则 PointerSensor 会先于 TouchSensor 激活，长按失效且任何 6px 移动都会变成拖拽、与滚动打架 */
export class MousePointerSensor extends PointerSensor {
  static activators = [
    {
      eventName: 'onPointerDown' as const,
      handler: (event: ReactPointerEvent, options: PointerSensorOptions): boolean => {
        if (event.nativeEvent.pointerType === 'touch') return false
        return PointerSensor.activators[0]?.handler(event, options) ?? false
      },
    },
  ]
}

function isDayContainerId(id: string | number): boolean {
  return String(id).startsWith(DAY_DROP_PREFIX)
}

type Rect = { top: number; left: number; bottom: number; right: number }

function rectContains(outer: Rect, inner: Rect): boolean {
  return inner.top >= outer.top && inner.bottom <= outer.bottom && inner.left >= outer.left && inner.right <= outer.right
}

/**
 * 跨容器碰撞：指针所在的容器优先（pointerWithin），其内再挑最近条目；
 * closestCenter 只做兜底（键盘拖拽 / 指针在容器间隙），且兜底时不选「未安排」容器——
 * 否则把条目拖到折叠天中心时，形状更近的「未安排」块会被 closestCenter 选中（冒烟 #5 dayId=null）。
 */
export const tripCollisionDetection: CollisionDetection = (args) => {
  if (!args.pointerCoordinates) return closestCenter(args)
  const within = pointerWithin(args)
  if (within.length === 0) {
    return closestCenter({
      ...args,
      droppableContainers: args.droppableContainers.filter((row) => row.id !== UNASSIGNED_DROP_ID),
    })
  }
  const itemHit = within.find((row) => !isDayContainerId(row.id))
  if (itemHit) return [itemHit]
  const container = within[0]
  const containerRect = container ? args.droppableRects.get(container.id) : undefined
  if (!container || !containerRect) return within
  // 指针在容器内但不在任何条目上（条目间隙 / 天标题）：取该容器内最近的条目；折叠天没有条目 → 容器本身（末尾）
  const inner = args.droppableContainers.filter((row) => {
    if (isDayContainerId(row.id)) return false
    const rect = args.droppableRects.get(row.id)
    return rect ? rectContains(containerRect, rect) : false
  })
  if (inner.length === 0) return [container]
  return closestCenter({ ...args, droppableContainers: inner })
}

function dayItemIds(items: ItemRecord[], dayId: string | null): string[] {
  return items
    .filter((row) => row.dayId === dayId)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((row) => row.id)
}

/** 某天已占用的点位数（只数 point/place；note/transit 不占位） */
function dayPointCount(items: ItemRecord[], dayId: string | null): number {
  if (dayId === null) return 0
  return items.filter((row) => row.dayId === dayId && (row.kind === 'point' || row.kind === 'place')).length
}

/** over.id → 目标天（item 上取它所在天；day 容器直接解析）；非天投放返回 undefined */
function resolveTargetDay(
  overId: string,
  items: ItemRecord[]
): { targetDayId: string | null; overItemIdInDay: string | null } | undefined {
  const overItemId = parseDragRecordId(overId, ITEM_DND_PREFIX)
  if (overItemId) {
    const overItem = items.find((row) => row.id === overItemId)
    if (!overItem) return undefined
    return { targetDayId: overItem.dayId, overItemIdInDay: overItemId }
  }
  const targetDayId = parseDayDropId(overId)
  if (targetDayId === undefined) return undefined
  return { targetDayId, overItemIdInDay: null }
}

export function useTripDnd({ items, pointPoolItems, reorder, addItem, onLimitBlocked }: UseTripDndOptions) {
  const [activeDragId, setActiveDragId] = useState<string | null>(null)
  // 拖拽悬停时目标天超限 → 置灰提示（drop 仍会在 dragEnd 拦截）
  const [limitBlockedDayId, setLimitBlockedDayId] = useState<string | null>(null)

  const sensors = useSensors(
    useSensor(MousePointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  /** 当前拖拽物是否占用点位名额（point/place 条目或池点位） */
  const dragOccupiesSlot = useCallback(
    (activeId: string): boolean => {
      const itemId = parseDragRecordId(activeId, ITEM_DND_PREFIX) ?? parseDragRecordId(activeId, MARKER_DND_PREFIX)
      if (itemId) {
        const dragged = items.find((row) => row.id === itemId)
        return dragged?.kind === 'point' || dragged?.kind === 'place'
      }
      return parseDragRecordId(activeId, POOL_DND_PREFIX) !== null
    },
    [items]
  )

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveDragId(String(event.active.id))
  }, [])

  const handleDragCancel = useCallback(() => {
    setActiveDragId(null)
    setLimitBlockedDayId(null)
  }, [])

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      const { active, over } = event
      if (!over) {
        setLimitBlockedDayId(null)
        return
      }
      const activeId = String(active.id)
      const resolved = resolveTargetDay(String(over.id), items)
      if (!resolved || resolved.targetDayId === null || !dragOccupiesSlot(activeId)) {
        setLimitBlockedDayId(null)
        return
      }
      // 同天内移动不占新名额
      const itemId = parseDragRecordId(activeId, ITEM_DND_PREFIX) ?? parseDragRecordId(activeId, MARKER_DND_PREFIX)
      const dragged = itemId ? items.find((row) => row.id === itemId) : undefined
      if (dragged && dragged.dayId === resolved.targetDayId) {
        setLimitBlockedDayId(null)
        return
      }
      setLimitBlockedDayId(dayPointCount(items, resolved.targetDayId) >= DAY_ITEM_LIMIT ? resolved.targetDayId : null)
    },
    [dragOccupiesSlot, items]
  )

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      setActiveDragId(null)
      setLimitBlockedDayId(null)
      const { active, over } = event
      if (!over) return
      const activeId = String(active.id)
      const overId = String(over.id)
      if (activeId === overId) return

      // 解析投放目标：item 上（插到它的位置）或 day 容器（末尾）
      const resolved = resolveTargetDay(overId, items)
      if (!resolved) return
      const { targetDayId, overItemIdInDay } = resolved

      const activeItemId =
        parseDragRecordId(activeId, ITEM_DND_PREFIX) ?? parseDragRecordId(activeId, MARKER_DND_PREFIX)

      if (activeItemId) {
        const dragged = items.find((row) => row.id === activeItemId)
        if (!dragged || dragged.kind === 'transit') return

        if (dragged.dayId === targetDayId) {
          // 同天重排：arrayMove 语义
          const dayIds = dayItemIds(items, targetDayId)
          const oldIndex = dayIds.indexOf(activeItemId)
          const newIndex = overItemIdInDay ? dayIds.indexOf(overItemIdInDay) : dayIds.length - 1
          if (oldIndex < 0 || newIndex < 0) return
          await reorder(targetDayId, arrayMove(dayIds, oldIndex, newIndex))
          return
        }

        // 跨天移动客户端预检：目标天 point/place 最多 25 个
        if (
          (dragged.kind === 'point' || dragged.kind === 'place') &&
          dayPointCount(items, targetDayId) >= DAY_ITEM_LIMIT
        ) {
          if (targetDayId !== null) onLimitBlocked?.(targetDayId)
          return
        }

        // 跨天移动：目标天列表 = 现有 + 插入 dragged
        const dayIds = dayItemIds(items, targetDayId)
        const at = overItemIdInDay ? Math.max(0, dayIds.indexOf(overItemIdInDay)) : dayIds.length
        dayIds.splice(at, 0, activeItemId)
        await reorder(targetDayId, dayIds)
        return
      }

      const activePoolId = parseDragRecordId(activeId, POOL_DND_PREFIX)
      if (activePoolId) {
        const poolItem = pointPoolItems.find((row) => row.id === activePoolId)
        if (!poolItem) return
        if (dayPointCount(items, targetDayId) >= DAY_ITEM_LIMIT) {
          if (targetDayId !== null) onLimitBlocked?.(targetDayId)
          return
        }
        const dayIds = dayItemIds(items, targetDayId)
        const at = overItemIdInDay ? Math.max(0, dayIds.indexOf(overItemIdInDay)) : undefined
        await addItem(targetDayId, { kind: 'point', pointId: poolItem.pointId }, at)
      }
    },
    [addItem, items, onLimitBlocked, pointPoolItems, reorder]
  )

  return { sensors, activeDragId, limitBlockedDayId, handleDragStart, handleDragOver, handleDragEnd, handleDragCancel }
}
