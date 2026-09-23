import { describe, it, expect, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { ClientRect, CollisionDetection, DragEndEvent, PointerSensorOptions } from '@dnd-kit/core'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { MousePointerSensor, tripCollisionDetection, useTripDnd } from '@/app/(authed)/me/routebooks/[id]/hooks/useTripDnd'
import type { ItemKind, ItemRecord, PointPoolItem } from '@/app/(authed)/me/routebooks/[id]/types'

function makeItem(id: string, dayId: string | null, sortOrder: number, kind: ItemKind = 'point'): ItemRecord {
  return {
    id,
    routeBookId: 'rb1',
    dayId,
    sortOrder,
    kind,
    pointId: kind === 'point' ? `pt-${id}` : null,
    placeId: kind === 'place' ? `pl-${id}` : null,
    title: kind === 'note' || kind === 'transit' ? id : null,
    note: null,
    timeStart: null,
    timeEnd: null,
    locked: false,
    icon: null,
    color: null,
    legMode: null,
    payload: null,
    createdAt: '2026-09-23T00:00:00.000Z',
  }
}

function makePoolItem(id: string, pointId: string): PointPoolItem {
  return { id, pointId, createdAt: '2026-09-23T00:00:00.000Z', updatedAt: '2026-09-23T00:00:00.000Z' }
}

// handleDragEnd 只读 active.id / over.id，其余字段补形即可
function dragEnd(activeId: string, overId: string | null): DragEndEvent {
  return {
    active: { id: activeId },
    over: overId === null ? null : { id: overId },
    collisions: [],
    delta: { x: 0, y: 0 },
    activatorEvent: new Event('pointerdown'),
  } as unknown as DragEndEvent
}

function setup(items: ItemRecord[], pointPoolItems: PointPoolItem[] = []) {
  const reorder = vi.fn(async (_dayId: string | null, _ids: string[]) => true)
  const addItem = vi.fn(async (_dayId: string | null, _input: { kind: 'point'; pointId: string }, _index?: number) => 'new-id')
  const onLimitBlocked = vi.fn()
  const view = renderHook(() => useTripDnd({ items, pointPoolItems, reorder, addItem, onLimitBlocked }))
  return { reorder, addItem, onLimitBlocked, view }
}

describe('useTripDnd onDragEnd 参数解析', () => {
  it('同天排序：拖到同天另一条目上 → arrayMove 语义', async () => {
    const items = [makeItem('i1', 'day1', 0), makeItem('i2', 'day1', 1), makeItem('i3', 'day1', 2)]
    const { reorder, view } = setup(items)

    await act(async () => {
      await view.result.current.handleDragEnd(dragEnd('item:i1', 'item:i3'))
    })

    expect(reorder).toHaveBeenCalledTimes(1)
    expect(reorder).toHaveBeenCalledWith('day1', ['i2', 'i3', 'i1'])
  })

  it('跨天移动：拖到天容器 → 追加到目标天末尾', async () => {
    const items = [makeItem('i1', 'day1', 0), makeItem('i4', 'day2', 0), makeItem('i5', 'day2', 1)]
    const { reorder, view } = setup(items)

    await act(async () => {
      await view.result.current.handleDragEnd(dragEnd('item:i1', 'day:day2'))
    })

    expect(reorder).toHaveBeenCalledTimes(1)
    expect(reorder).toHaveBeenCalledWith('day2', ['i4', 'i5', 'i1'])
  })

  it('冒烟 #5：拖到折叠 Day 2（over=day:day2，无子条目）→ reorder dayId=day2 末尾', async () => {
    const items = [
      makeItem('i1', 'day1', 0),
      makeItem('i2', 'day1', 1),
      makeItem('u1', null, 0),
      makeItem('d2a', 'day2', 0),
    ]
    const { reorder, view } = setup(items)

    await act(async () => {
      await view.result.current.handleDragEnd(dragEnd('item:i2', 'day:day2'))
    })

    expect(reorder).toHaveBeenCalledTimes(1)
    expect(reorder).toHaveBeenCalledWith('day2', ['d2a', 'i2'])
  })

  it('从池拖入：pool 条目落到天容器 → addItem 末尾（index undefined）', async () => {
    const items = [makeItem('i1', 'day1', 0)]
    const { addItem, reorder, view } = setup(items, [makePoolItem('pool1', 'pt-x')])

    await act(async () => {
      await view.result.current.handleDragEnd(dragEnd('pool:pool1', 'day:day1'))
    })

    expect(addItem).toHaveBeenCalledTimes(1)
    expect(addItem).toHaveBeenCalledWith('day1', { kind: 'point', pointId: 'pt-x' }, undefined)
    expect(reorder).not.toHaveBeenCalled()
  })

  it('从标记拖入：marker 落到另一天的条目上 → 插到该条目位置', async () => {
    const items = [makeItem('i1', 'day1', 0), makeItem('i4', 'day2', 0), makeItem('i5', 'day2', 1)]
    const { reorder, view } = setup(items)

    await act(async () => {
      await view.result.current.handleDragEnd(dragEnd('marker:i1', 'item:i5'))
    })

    expect(reorder).toHaveBeenCalledTimes(1)
    expect(reorder).toHaveBeenCalledWith('day2', ['i4', 'i1', 'i5'])
  })

  it('目标天 point/place 满 25 条：拦截 reorder 并提示', async () => {
    const full = Array.from({ length: 25 }, (_, index) => makeItem(`f${index}`, 'day2', index))
    const items = [makeItem('i1', 'day1', 0), ...full]
    const { reorder, onLimitBlocked, view } = setup(items)

    await act(async () => {
      await view.result.current.handleDragEnd(dragEnd('item:i1', 'day:day2'))
    })

    expect(reorder).not.toHaveBeenCalled()
    expect(onLimitBlocked).toHaveBeenCalledTimes(1)
    expect(onLimitBlocked).toHaveBeenCalledWith('day2')
  })

  it('上限只数 point/place：note/transit 不占名额', async () => {
    const filler = [
      ...Array.from({ length: 24 }, (_, index) => makeItem(`f${index}`, 'day2', index)),
      makeItem('n1', 'day2', 24, 'note'),
      makeItem('tr1', 'day2', 25, 'transit'),
    ]
    const items = [makeItem('i1', 'day1', 0), ...filler]
    const { reorder, onLimitBlocked, view } = setup(items)

    await act(async () => {
      await view.result.current.handleDragEnd(dragEnd('item:i1', 'day:day2'))
    })

    expect(onLimitBlocked).not.toHaveBeenCalled()
    expect(reorder).toHaveBeenCalledTimes(1)
    expect(reorder.mock.calls[0]?.[0]).toBe('day2')
    expect(reorder.mock.calls[0]?.[1]).toHaveLength(27)
  })

  it('同天重排不受上限影响；未安排区（null）不设限', async () => {
    const full = Array.from({ length: 25 }, (_, index) => makeItem(`f${index}`, 'day1', index))
    const { reorder, onLimitBlocked, view } = setup(full)

    await act(async () => {
      await view.result.current.handleDragEnd(dragEnd('item:f0', 'item:f24'))
    })

    expect(onLimitBlocked).not.toHaveBeenCalled()
    expect(reorder).toHaveBeenCalledWith(
      'day1',
      [...full.slice(1).map((row) => row.id), 'f0']
    )
  })
})

describe('MousePointerSensor（B3 触屏修复）', () => {
  function activate(pointerType: string): boolean {
    const handler = MousePointerSensor.activators[0]!.handler
    const nativeEvent = { pointerType, isPrimary: true, button: 0 }
    const onActivation = vi.fn()
    return handler({ nativeEvent } as unknown as ReactPointerEvent, { onActivation } as PointerSensorOptions)
  }

  it('touch 的 pointerdown 不激活鼠标传感器（交给 TouchSensor 长按）', () => {
    expect(activate('touch')).toBe(false)
  })

  it('mouse / pen 的主键 pointerdown 正常激活', () => {
    expect(activate('mouse')).toBe(true)
    expect(activate('pen')).toBe(true)
  })

  it('hook 同时注册鼠标、触屏（长按）与键盘传感器', () => {
    const { view } = setup([])
    const sensors = view.result.current.sensors
    expect(sensors.map((row) => row.sensor)).toContain(MousePointerSensor)
    expect(sensors.find((row) => row.sensor !== MousePointerSensor && 'activationConstraint' in row.options)?.options).toMatchObject({
      activationConstraint: { delay: 200, tolerance: 8 },
    })
  })
})

describe('tripCollisionDetection（冒烟 #5 跨天拖拽）', () => {
  function rect(top: number, height: number, left = 0, width = 400): ClientRect {
    return { top, left, width, height, bottom: top + height, right: left + width }
  }

  // 桌面左栏：Day 1 展开（含两条目）、Day 2 折叠、「未安排」块（含一条目）
  const rects: Record<string, ClientRect> = {
    'day:day1': rect(0, 300),
    'item:i1': rect(60, 60, 8, 384),
    'item:i2': rect(180, 60, 8, 384),
    'day:day2': rect(310, 56),
    'day:unassigned': rect(380, 120),
    'item:u1': rect(430, 50, 8, 384),
  }

  function run(pointer: { x: number; y: number } | null, collisionRect: ClientRect) {
    const droppableRects = new Map(Object.entries(rects))
    const droppableContainers = Object.keys(rects).map((id) => ({ id, key: id, data: { current: {} }, disabled: false, node: { current: null }, rect: { current: rects[id] } }))
    const args = {
      active: { id: 'item:i2', data: { current: {} }, rect: { current: { initial: null, translated: null } } },
      collisionRect,
      droppableRects,
      droppableContainers,
      pointerCoordinates: pointer,
    } as unknown as Parameters<CollisionDetection>[0]
    return tripCollisionDetection(args).map((row) => String(row.id))
  }

  it('指针在折叠 Day 2 中心 → 选 day:day2（即使拖影更靠近「未安排」）', () => {
    expect(run({ x: 200, y: 338 }, rect(400, 60, 8, 384))[0]).toBe('day:day2')
  })

  it('指针在展开天的条目上 → 选该条目而非外层天容器', () => {
    expect(run({ x: 200, y: 90 }, rect(60, 60, 8, 384))[0]).toBe('item:i1')
  })

  it('指针在展开天的条目间隙 → 选该天内最近的条目', () => {
    expect(run({ x: 200, y: 170 }, rect(170, 60, 8, 384))[0]).toBe('item:i2')
  })

  it('指针不在任何容器内（间隙）→ 兜底 closestCenter 不选「未安排」容器', () => {
    const hits = run({ x: 200, y: 372 }, rect(372, 30, 0, 400))
    expect(hits[0]).not.toBe('day:unassigned')
  })
})
