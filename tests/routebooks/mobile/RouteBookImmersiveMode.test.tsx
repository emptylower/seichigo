import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { RouteBookImmersiveMode } from '@/app/(authed)/me/routebooks/[id]/components/RouteBookImmersiveMode'
import type { ItemRecord, PlaceRecord } from '@/app/(authed)/me/routebooks/[id]/types'

// 打卡弹窗替身：一个按钮直接触发 onSuccess（真实组件要拍照/定位）
vi.mock('@/components/checkin/CheckInModal', () => ({
  default: ({ onSuccess }: { onSuccess: () => void }) => (
    <button type="button" onClick={onSuccess}>
      mock-checkin-success
    </button>
  ),
}))

const PLACE: PlaceRecord = {
  id: 'place-1',
  routeBookId: 'rb1',
  kind: 'restaurant',
  title: 'Uji Tea House',
  address: 'Uji, Kyoto',
  lat: 34.8892,
  lng: 135.8075,
  note: null,
  createdAt: '2026-09-23T00:00:00.000Z',
}

function makeItem(overrides: Partial<ItemRecord>): ItemRecord {
  return {
    id: 'item-1',
    routeBookId: 'rb1',
    dayId: 'day1',
    sortOrder: 0,
    kind: 'place',
    pointId: null,
    placeId: 'place-1',
    title: null,
    note: null,
    timeStart: null,
    timeEnd: null,
    locked: false,
    icon: null,
    color: null,
    legMode: null,
    payload: null,
    createdAt: '2026-09-23T00:00:00.000Z',
    ...overrides,
  }
}

function getPointPreview() {
  return {
    title: 'Uji Bridge',
    subtitle: 'Haruhi Suzumiya',
    image: null,
    geo: [34.8892, 135.8075] as [number, number],
  }
}

function renderImmersive(overrides: Partial<Parameters<typeof RouteBookImmersiveMode>[0]> = {}) {
  const props = {
    routeBookTitle: 'Test Trip',
    sequence: [makeItem({ id: 'item-place' })],
    places: [PLACE],
    dayLabel: 'Day 1',
    checkedInPointIds: new Set<string>(),
    getPointPreview,
    onCheckInSuccess: vi.fn(),
    onUndoCheckIn: vi.fn().mockResolvedValue(true),
    onClose: vi.fn(),
    locale: 'zh' as const,
    ...overrides,
  }
  const view = render(<RouteBookImmersiveMode {...props} />)
  return { props, ...view }
}

/** intro → cards 进入首站 */
function enterCards() {
  fireEvent.click(screen.getByRole('button', { name: /进入导航/ }))
}

describe('RouteBookImmersiveMode place 条目', () => {
  it('place 站导航态不显示打卡按钮，显示「到达 · 下一站」', () => {
    renderImmersive()
    enterCards()
    // 首站是 place：点「导航」进入导航态
    fireEvent.click(screen.getByRole('button', { name: '导航' }))
    expect(screen.queryByRole('button', { name: '导航完成并打卡' })).toBeNull()
    expect(screen.getByRole('button', { name: '到达 · 下一站' })).toBeTruthy()
  })

  it('point 站导航态仍显示打卡按钮', () => {
    renderImmersive({
      sequence: [makeItem({ id: 'item-point', kind: 'point', pointId: '115908:uji-bridge', placeId: null })],
    })
    enterCards()
    fireEvent.click(screen.getByRole('button', { name: '导航' }))
    expect(screen.getByRole('button', { name: '导航完成并打卡' })).toBeTruthy()
  })
})

describe('RouteBookImmersiveMode 最后一站完成', () => {
  it('有下一天：总结文案含下一天首站名（明天从 X 开始）', () => {
    renderImmersive({ nextDayFirstTitle: '宇治上神社' })
    enterCards()
    // 最后一站是 place → 「完成今天」
    fireEvent.click(screen.getByRole('button', { name: '完成今天' }))
    expect(screen.getByText('Day 1 完成')).toBeTruthy()
    expect(screen.getByText('明天从 宇治上神社 开始')).toBeTruthy()
  })

  it('没有下一天：显示「全部完成」', () => {
    renderImmersive({ nextDayFirstTitle: null })
    enterCards()
    fireEvent.click(screen.getByRole('button', { name: '完成今天' }))
    expect(screen.getByText('全部完成')).toBeTruthy()
  })
})

describe('RouteBookImmersiveMode [place, point] 序列（B3 修复 F3）', () => {
  it('到达 place → 打卡 point → 进入完成态，不会回到 place', () => {
    const sequence = [
      makeItem({ id: 'item-place', sortOrder: 0 }),
      makeItem({ id: 'item-point', sortOrder: 1, kind: 'point', pointId: '115908:uji-bridge', placeId: null }),
    ]
    const { props, rerender } = renderImmersive({ sequence })
    enterCards()

    // 第一站 place：导航 → 到达 · 下一站
    expect(screen.getByRole('heading', { name: 'Uji Tea House' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '导航' }))
    fireEvent.click(screen.getByRole('button', { name: '到达 · 下一站' }))

    // 第二站 point：导航 → 导航完成并打卡 → 打卡成功
    expect(screen.getByRole('heading', { name: 'Uji Bridge' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '导航' }))
    fireEvent.click(screen.getByRole('button', { name: '导航完成并打卡' }))
    fireEvent.click(screen.getByRole('button', { name: 'mock-checkin-success' }))
    expect(props.onCheckInSuccess).toHaveBeenCalledWith('115908:uji-bridge')

    // 父级把打卡结果回灌
    rerender(<RouteBookImmersiveMode {...props} checkedInPointIds={new Set(['115908:uji-bridge'])} />)
    expect(screen.getByText('Day 1 完成')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Uji Tea House' })).toBeNull()
  })

  it('跳过中间站后继续推进到下一站', () => {
    const sequence = [
      makeItem({ id: 'item-point', sortOrder: 0, kind: 'point', pointId: '115908:uji-bridge', placeId: null }),
      makeItem({ id: 'item-place', sortOrder: 1 }),
    ]
    renderImmersive({ sequence })
    enterCards()
    fireEvent.click(screen.getByRole('button', { name: '跳过' }))
    expect(screen.getByRole('heading', { name: 'Uji Tea House' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '完成今天' }))
    expect(screen.getByText('Day 1 完成')).toBeTruthy()
  })
})

describe('RouteBookImmersiveMode 撤销打卡（G15）', () => {
  const TITLES: Record<string, string> = { 'p:a': 'Spot A', 'p:b': 'Spot B' }
  const previewById = (pointId: string) => ({
    title: TITLES[pointId] ?? pointId,
    subtitle: '',
    image: null,
    geo: [34.88, 135.8] as [number, number],
  })
  const pointItem = (id: string, pointId: string, sortOrder: number) =>
    makeItem({ id, kind: 'point', pointId, placeId: null, sortOrder })

  /** 与 ui.tsx 一致：打卡集合在父级，打卡成功/撤销时回灌 */
  function StatefulHarness({
    sequence,
    undoResult = true,
    onUndo,
  }: {
    sequence: ItemRecord[]
    undoResult?: boolean
    onUndo: (pointId: string) => void
  }) {
    const [checked, setChecked] = useState<Set<string>>(() => new Set())
    return (
      <RouteBookImmersiveMode
        routeBookTitle="Test Trip"
        sequence={sequence}
        places={[]}
        dayLabel="Day 1"
        checkedInPointIds={checked}
        getPointPreview={previewById}
        onCheckInSuccess={(pointId) => setChecked((prev) => new Set(prev).add(pointId))}
        onUndoCheckIn={async (pointId) => {
          onUndo(pointId)
          if (!undoResult) return false
          setChecked((prev) => {
            const next = new Set(prev)
            next.delete(pointId)
            return next
          })
          return true
        }}
        onClose={() => {}}
        locale="zh"
      />
    )
  }

  function checkInCurrent() {
    fireEvent.click(screen.getByRole('button', { name: '导航' }))
    fireEvent.click(screen.getByRole('button', { name: '导航完成并打卡' }))
    fireEvent.click(screen.getByRole('button', { name: 'mock-checkin-success' }))
  }

  it('中间站打卡后撤销：回到该站，撤销条消失', async () => {
    const onUndo = vi.fn()
    render(<StatefulHarness sequence={[pointItem('i-a', 'p:a', 0), pointItem('i-b', 'p:b', 1)]} onUndo={onUndo} />)
    enterCards()
    expect(screen.getByRole('heading', { name: 'Spot A' })).toBeTruthy()
    checkInCurrent()
    expect(screen.getByRole('heading', { name: 'Spot B' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '撤销打卡' }))
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Spot A' })).toBeTruthy())
    expect(onUndo).toHaveBeenCalledWith('p:a')
    expect(screen.queryByRole('button', { name: '撤销打卡' })).toBeNull()
  })

  it('最后一站打卡进入完成态后撤销：离开完成态，回到最后一站', async () => {
    const onUndo = vi.fn()
    render(<StatefulHarness sequence={[pointItem('i-a', 'p:a', 0)]} onUndo={onUndo} />)
    enterCards()
    checkInCurrent()
    expect(screen.getByText('Day 1 完成')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '撤销打卡' }))
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Spot A' })).toBeTruthy())
    expect(screen.queryByText('Day 1 完成')).toBeNull()
    expect(onUndo).toHaveBeenCalledWith('p:a')
    // 撤销后可以重新打卡并再次完成
    checkInCurrent()
    expect(screen.getByText('Day 1 完成')).toBeTruthy()
  })

  it('撤销失败：保留当前进度并提示', async () => {
    const onUndo = vi.fn()
    render(
      <StatefulHarness sequence={[pointItem('i-a', 'p:a', 0), pointItem('i-b', 'p:b', 1)]} undoResult={false} onUndo={onUndo} />
    )
    enterCards()
    checkInCurrent()
    fireEvent.click(screen.getByRole('button', { name: '撤销打卡' }))
    await waitFor(() => expect(screen.getByText('撤销失败，请稍后重试。')).toBeTruthy())
    expect(screen.getByRole('heading', { name: 'Spot B' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '撤销打卡' })).toBeTruthy()
  })
})
