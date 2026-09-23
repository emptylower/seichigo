'use client'

import { useCallback, useState } from 'react'
import {
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import type { ItemRecord, PointPoolItem } from '../types'
import { ITEM_DND_PREFIX, MARKER_DND_PREFIX, POOL_DND_PREFIX } from '../types'
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
}

function dayItemIds(items: ItemRecord[], dayId: string | null): string[] {
  return items
    .filter((row) => row.dayId === dayId)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((row) => row.id)
}

export function useTripDnd({ items, pointPoolItems, reorder, addItem }: UseTripDndOptions) {
  const [activeDragId, setActiveDragId] = useState<string | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveDragId(String(event.active.id))
  }, [])

  const handleDragCancel = useCallback(() => {
    setActiveDragId(null)
  }, [])

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      setActiveDragId(null)
      const { active, over } = event
      if (!over) return
      const activeId = String(active.id)
      const overId = String(over.id)
      if (activeId === overId) return

      // 解析投放目标：item 上（插到它的位置）或 day 容器（末尾）
      let targetDayId: string | null | undefined
      let overItemIdInDay: string | null = null
      const overItemId = parseDragRecordId(overId, ITEM_DND_PREFIX)
      if (overItemId) {
        const overItem = items.find((row) => row.id === overItemId)
        if (!overItem) return
        targetDayId = overItem.dayId
        overItemIdInDay = overItemId
      } else {
        targetDayId = parseDayDropId(overId)
        if (targetDayId === undefined) return
      }

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
        const dayIds = dayItemIds(items, targetDayId)
        const at = overItemIdInDay ? Math.max(0, dayIds.indexOf(overItemIdInDay)) : undefined
        await addItem(targetDayId, { kind: 'point', pointId: poolItem.pointId }, at)
      }
    },
    [addItem, items, pointPoolItems, reorder]
  )

  return { sensors, activeDragId, handleDragStart, handleDragEnd, handleDragCancel }
}
