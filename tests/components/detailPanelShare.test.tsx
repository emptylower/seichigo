import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import DetailPanel from '@/features/map/anitabi/DetailPanel'
import { L } from '@/features/map/anitabi/shared'

function makeProps(overrides: Record<string, unknown> = {}) {
  const point = {
    id: '101:suga',
    bangumiId: 101,
    name: '须贺神社',
    nameZh: '须贺神社',
    note: null,
    geo: [35.6, 139.7] as [number, number],
    ep: '1',
    s: null,
    image: null,
    origin: null,
    originUrl: null,
    originLink: null,
    density: null,
    mark: null,
  }
  return {
    label: L.zh,
    attributionLabel: 'via Anitabi',
    detail: { card: { id: 101, title: '你的名字。', city: '东京', cover: null }, points: [point] } as any,
    detailCardMode: 'point' as const,
    selectedPoint: point,
    selectedPointState: 'none',
    selectedPointDistanceMeters: null,
    selectedPointPanoramaAvailable: false,
    detailLoading: false,
    workDetailExpanded: false,
    quickPilgrimageProgress: { checked: 0, total: 1 },
    viewFilter: 'all' as const,
    stateFilter: [] as string[],
    detailPoints: [{ point, distanceMeters: null }],
    selectedPointImage: null,
    showWantToGoAction: false,
    formatDistance: (m: number) => `${m}m`,
    geoHref: null,
    onCloseWorkDetail: vi.fn(),
    onSwitchToBangumiDetail: vi.fn(),
    onToggleWorkDetailExpanded: vi.fn(),
    onShowQuickPilgrimage: vi.fn(),
    onChangeViewFilter: vi.fn(),
    onToggleStateFilter: vi.fn(),
    onSelectPoint: vi.fn(),
    onAddSelectedPointToPool: vi.fn(),
    onShowSharePanel: vi.fn(),
    onEnterPanorama: vi.fn(),
    onAddPointToPool: vi.fn(),
    getPointState: () => 'none',
    ...overrides,
  }
}

describe('DetailPanel 分享按钮', () => {
  it('未打卡也常驻显示，点击触发 onShowSharePanel', () => {
    const onShowSharePanel = vi.fn()
    render(<DetailPanel {...(makeProps({ onShowSharePanel }) as any)} />)
    const button = screen.getByRole('button', { name: L.zh.share })
    fireEvent.click(button)
    expect(onShowSharePanel).toHaveBeenCalledTimes(1)
  })

  it('不再有硬编码的「打卡卡片」按钮', () => {
    render(<DetailPanel {...(makeProps() as any)} />)
    expect(screen.queryByText('打卡卡片')).not.toBeInTheDocument()
  })
})
