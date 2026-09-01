import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))
vi.mock('@/components/route/RoutePreviewMap', () => ({
  RoutePreviewMap: () => <div data-testid="route-map" />,
}))
vi.mock('@/components/map/ResilientMapImage', () => ({
  default: (props: { src: string | null; alt: string }) => <div data-testid="resilient-image">{props.alt}</div>,
}))

import { DayCards, DaymapCard } from '@/app/(authed)/plan/[id]/components/DayCards'
import type { DaymapMessagePayload, TripPlanDayView } from '@/lib/tripPlan/view'

function day(overrides: Partial<TripPlanDayView>): TripPlanDayView {
  return {
    id: 'day-1',
    dayIndex: 1,
    date: null,
    citySlug: null,
    summary: null,
    items: [],
    ...overrides,
  }
}

function daymap(overrides?: Partial<DaymapMessagePayload>): DaymapMessagePayload {
  return {
    type: 'daymap',
    revisionId: 'rev-1',
    savedAt: '2026-09-01T08:30:00Z',
    days: [
      day({
        id: 'day-a1',
        dayIndex: 1,
        summary: '宇治巡礼日',
        items: [
          {
            id: 'i1',
            sortOrder: 0,
            type: 'point',
            pointId: '115908:uji',
            timeHint: null,
            title: '宇治桥',
            note: null,
            reason: null,
            payload: null,
            point: { id: '115908:uji', name: '宇治橋', nameZh: '宇治桥', lat: 34.8892, lng: 135.8075, image: null },
          },
        ],
      }),
      day({ id: 'day-a2', dayIndex: 2, summary: '京都日', items: [] }),
    ],
    ...overrides,
  }
}

describe('DaymapCard（聊天时间线里的历史快照）', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('渲染快照标签（含保存时间）、天数 tab 与条目；revision 透传为 data 属性', () => {
    const { container } = render(<DaymapCard planId="plan-1" daymap={daymap()} />)
    expect(container.querySelector('[data-daymap-revision="rev-1"]')).not.toBeNull()
    expect(screen.getByText('行程快照 · 已保存')).toBeTruthy()
    expect(screen.getByText(/09-01/)).toBeTruthy()
    expect(screen.getByText('Day 1')).toBeTruthy()
    expect(screen.getByText('Day 2')).toBeTruthy()
    expect(screen.getByText('宇治桥')).toBeTruthy()
  })

  it('历史快照是只读作用域：不显示"保存到我的地图"，显示"历史快照 · 只读"', () => {
    render(<DaymapCard planId="plan-1" daymap={daymap()} />)
    expect(screen.getByText('历史快照 · 只读')).toBeTruthy()
    expect(screen.queryByText('保存到我的地图')).toBeNull()
  })

  it('当前计划作用域仍显示"保存到我的地图"（legacy 行为保持）', () => {
    render(<DayCards planId="plan-1" days={daymap().days} scope="current" />)
    expect(screen.getByText('保存到我的地图')).toBeTruthy()
    expect(screen.queryByText('历史快照 · 只读')).toBeNull()
  })

  it('两个 daymap 快照的 Day tab 状态独立：切 A 的天不影响 B', () => {
    const snapshotA = daymap({ revisionId: 'rev-a', days: [day({ id: 'da1', dayIndex: 1, summary: 'A 第 1 天' }), day({ id: 'da2', dayIndex: 2, summary: 'A 第 2 天' })] })
    const snapshotB = daymap({
      revisionId: 'rev-b',
      savedAt: '2026-09-02T10:00:00Z',
      days: [day({ id: 'db1', dayIndex: 1, summary: 'B 第 1 天' }), day({ id: 'db2', dayIndex: 2, summary: 'B 第 2 天' })],
    })
    const { container } = render(
      <div>
        <DaymapCard planId="plan-1" daymap={snapshotA} />
        <DaymapCard planId="plan-1" daymap={snapshotB} />
      </div>,
    )

    // 初始都停在各自的 Day 1
    expect(screen.getByText('A 第 1 天')).toBeTruthy()
    expect(screen.getByText('B 第 1 天')).toBeTruthy()

    // 切 A（第一个快照）到 Day 2：只影响 A
    const cardA = container.querySelector('[data-daymap-revision="rev-a"]')!
    const tabA2 = Array.from(cardA.querySelectorAll('button')).find((b) => b.textContent === 'Day 2')!
    fireEvent.click(tabA2)
    expect(screen.getByText('A 第 2 天')).toBeTruthy()
    expect(screen.queryByText('A 第 1 天')).toBeNull()
    // B 仍在 Day 1
    expect(screen.getByText('B 第 1 天')).toBeTruthy()
    expect(screen.queryByText('B 第 2 天')).toBeNull()
  })
})
