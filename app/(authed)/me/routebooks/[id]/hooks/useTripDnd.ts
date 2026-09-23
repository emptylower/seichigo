'use client'

import { useCallback, useState } from 'react'
import {
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import type { ItemRecord, PointPoolItem } from '../types'
import { DAY_ITEM_LIMIT, ITEM_DND_PREFIX, MARKER_DND_PREFIX, POOL_DND_PREFIX } from '../types'
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
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
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
