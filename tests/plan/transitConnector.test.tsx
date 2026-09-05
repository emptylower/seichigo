import { describe, it, expect } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { TransitConnector } from '@/app/(authed)/plan/[id]/components/TransitConnector'
import type { TripPlanItemView } from '@/lib/tripPlan/view'

function transitItem(payload: Record<string, unknown>): TripPlanItemView {
  return {
    id: 't1',
    sortOrder: 0,
    type: 'transit',
    pointId: null,
    timeHint: null,
    title: '移动',
    note: null,
    reason: null,
    payload: payload as TripPlanItemView['payload'],
    point: null,
  }
}

function renderRow(
  payload: Record<string, unknown>,
  opts?: { origin?: { lat: number; lng: number } | null; destination?: { lat: number; lng: number } | null },
) {
  return render(
    <ul>
      <TransitConnector
        item={transitItem(payload)}
        origin={opts?.origin ?? null}
        destination={opts?.destination ?? null}
      />
    </ul>,
  )
}

const MIXED_TRANSPORT = {
  mode: 'transit',
  durationMin: 26,
  distanceKm: 5.4,
  transfers: 0,
  legs: [
    { mode: 'walk', durationMin: 5, distanceKm: 0.4, instruction: '沿宇治川向东' },
    {
      mode: 'transit',
      line: 'JR奈良线',
      headsign: '京都',
      fromStop: '宇治駅',
      toStop: '京都駅',
      numStops: 4,
      durationMin: 18,
      departureTime: '09:12',
      arrivalTime: '09:30',
    },
    { mode: 'walk', durationMin: 3, distanceKm: 0.25 },
  ],
}

describe('TransitConnector 折叠摘要', () => {
  it('纯步行：步行 12 分钟', () => {
    renderRow({
      transport: {
        mode: 'walk',
        durationMin: 12,
        distanceKm: 0.9,
        legs: [{ mode: 'walk', durationMin: 12, distanceKm: 0.9, instruction: '沿宇治川向东' }],
      },
    })
    expect(screen.getByText('步行 12 分钟')).toBeInTheDocument()
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'false')
  })

  it('混合：先步行 5 分钟，再乘车 18 分钟，最后步行 3 分钟', () => {
    renderRow({ transport: MIXED_TRANSPORT })
    expect(screen.getByText('先步行 5 分钟，再乘车 18 分钟，最后步行 3 分钟')).toBeInTheDocument()
  })

  it('全乘车含换乘：乘车 25 分钟（换乘 1 次）', () => {
    renderRow({
      transport: {
        mode: 'transit',
        durationMin: 25,
        legs: [
          { mode: 'transit', line: '京阪本线', durationMin: 15 },
          { mode: 'transit', line: 'JR奈良线', durationMin: 10 },
        ],
      },
    })
    expect(screen.getByText('乘车 25 分钟（换乘 1 次）')).toBeInTheDocument()
  })

  it('估算载荷（legs 为空）：约 45 分钟 · 参考估算', () => {
    renderRow({
      transport: { mode: 'transit', durationMin: 45, distanceKm: 20, estimated: true, provider: 'estimate' },
    })
    expect(screen.getByText('约 45 分钟 · 参考估算')).toBeInTheDocument()
  })
})

describe('TransitConnector 展开详情', () => {
  it('纯步行展开：逐步文案 + 总计行；再次点击收起', () => {
    renderRow({
      transport: {
        mode: 'walk',
        durationMin: 12,
        distanceKm: 0.9,
        legs: [{ mode: 'walk', durationMin: 12, distanceKm: 0.9, instruction: '沿宇治川向东' }],
      },
    })
    const toggle = screen.getByRole('button')
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('步行 12 分钟（900 m） · 沿宇治川向东')).toBeInTheDocument()
    expect(screen.getByText('总计 12 分钟 · 900 m')).toBeInTheDocument()

    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('总计 12 分钟 · 900 m')).toBeNull()
  })

  it('混合展开：乘车段含方向/上下车站/站数/时刻', () => {
    renderRow({ transport: MIXED_TRANSPORT })
    fireEvent.click(screen.getByRole('button'))
    expect(
      screen.getByText('乘 JR奈良线（往 京都） · 宇治駅 → 京都駅 · 4 站 · 18 分钟 · 09:12 发 – 09:30 到'),
    ).toBeInTheDocument()
    expect(screen.getByText('总计 26 分钟 · 5.4 km')).toBeInTheDocument()
  })

  it('估算载荷展开：note 文案 + 当地查询提示 + Google 地图链接（mapsUrl 优先）', () => {
    renderRow({
      transport: {
        mode: 'transit',
        durationMin: 45,
        distanceKm: 20,
        estimated: true,
        provider: 'estimate',
        note: '日本公交线路暂无法查询，以下为参考估算',
        mapsUrl: 'https://www.google.com/maps/dir/?api=1&origin=35.69,139.7&destination=35.5,138.76&travelmode=transit',
      },
    })
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText('日本公交线路暂无法查询，以下为参考估算')).toBeInTheDocument()
    expect(screen.getByText('到达当地后可用 Google 地图 / Yahoo!乗換案内 查询实时路线')).toBeInTheDocument()
    const link = screen.getByRole('link', { name: '在 Google 地图打开' })
    expect(link).toHaveAttribute(
      'href',
      'https://www.google.com/maps/dir/?api=1&origin=35.69,139.7&destination=35.5,138.76&travelmode=transit',
    )
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('无 mapsUrl 时用前后条目坐标拼 Google 导航链接', () => {
    renderRow(
      { transport: { mode: 'walk', durationMin: 8, distanceKm: 0.65 } },
      { origin: { lat: 1, lng: 2 }, destination: { lat: 3, lng: 4 } },
    )
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByRole('link', { name: '在 Google 地图打开' })).toHaveAttribute(
      'href',
      'https://www.google.com/maps/dir/?api=1&origin=1,2&destination=3,4&travelmode=transit',
    )
  })
})
