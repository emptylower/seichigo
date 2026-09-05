import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('@/components/map/ResilientMapImage', () => ({
  default: (props: { src: string | null; alt: string; kind?: string; loading?: string; fallbackSrc?: string | null }) => (
    <img
      data-testid="resilient-image"
      data-src={props.src ?? ''}
      data-kind={props.kind ?? ''}
      data-loading={props.loading ?? ''}
      data-fallback-src={props.fallbackSrc ?? ''}
      alt={props.alt}
    />
  ),
}))

import { DayPointCard, buildStreetViewUrl } from '@/app/(authed)/plan/[id]/components/DayPointCard'
import { buildPointNavigationUrl } from '@/app/(authed)/plan/[id]/lib/navigationLinks'
import type { TripPlanItemView } from '@/lib/tripPlan/view'

const UJI = { lat: 34.8892, lng: 135.8075 }

function item(overrides: Partial<TripPlanItemView> = {}): TripPlanItemView {
  return {
    id: 'item-1',
    sortOrder: 0,
    type: 'point',
    pointId: '115908:uji',
    timeHint: null,
    title: '宇治桥',
    note: null,
    reason: null,
    payload: { schedule: { start: '09:00', end: '10:30', confidence: 'explicit' } },
    point: { id: '115908:uji', name: '宇治橋', nameZh: '宇治桥', lat: UJI.lat, lng: UJI.lng, image: null },
    ...overrides,
  } as TripPlanItemView
}

function renderCard(overrides: Partial<Parameters<typeof DayPointCard>[0]> = {}) {
  return render(
    <DayPointCard item={item()} title="宇治桥" lat={UJI.lat} lng={UJI.lng} {...overrides} />,
  )
}

describe('DayPointCard 迷你地图点位卡（B3）', () => {
  it('渲染标题、时间 chip 与一句说明（reason 优先于 note）', () => {
    renderCard({ item: item({ reason: '京吹开场镜头的取景地', note: '备注不展示' }) })
    expect(screen.getByText('宇治桥')).toBeTruthy()
    expect(screen.getByText('09:00–10:30')).toBeTruthy()
    expect(screen.getByText('京吹开场镜头的取景地')).toBeTruthy()
    expect(screen.queryByText('备注不展示')).toBeNull()
  })

  it('reason 缺失时回退 note', () => {
    renderCard({ item: item({ reason: null, note: '记得买抹茶冰淇淋' }) })
    expect(screen.getByText('记得买抹茶冰淇淋')).toBeTruthy()
  })

  it('图片阶梯与 DayCards 一致：media.displayUrl → point.image → point-photo 兜底', () => {
    const withMedia = renderCard({
      item: item({ payload: { media: { displayUrl: 'https://img.anitabi.cn/a.jpg', source: 'point' } } }),
    })
    expect(screen.getByTestId('resilient-image').getAttribute('data-src')).toBe('https://img.anitabi.cn/a.jpg')
    // 首屏可见的小卡：eager 加载 + 与列表同一档缩略图变体
    expect(screen.getByTestId('resilient-image').getAttribute('data-kind')).toBe('point-thumbnail')
    expect(screen.getByTestId('resilient-image').getAttribute('data-loading')).toBe('eager')
    withMedia.unmount()

    const withPointImage = renderCard({
      item: item({
        payload: null,
        point: { id: '115908:uji', name: '宇治橋', nameZh: '宇治桥', lat: UJI.lat, lng: UJI.lng, image: 'https://img.anitabi.cn/p.jpg' },
      }),
    })
    expect(screen.getByTestId('resilient-image').getAttribute('data-src')).toBe('https://img.anitabi.cn/p.jpg')
    withPointImage.unmount()

    renderCard({ item: item({ payload: null }) })
    const img = screen.getByTestId('resilient-image')
    expect(img.getAttribute('data-src')).toContain('/api/google/point-photo?pointId=115908%3Auji')
  })

  it('高-3：有 media.attribution 时在图上渲染署名，没有则不渲染', () => {
    const withAttribution = renderCard({
      item: item({
        payload: { media: { displayUrl: 'https://img.anitabi.cn/a.jpg', source: 'google_places', attribution: '照片：Taro' } },
      }),
    })
    expect(screen.getByText('照片：Taro')).toBeTruthy()
    withAttribution.unmount()

    renderCard({ item: item({ payload: { media: { displayUrl: 'https://img.anitabi.cn/a.jpg', source: 'point' } } }) })
    expect(screen.queryByText('照片：Taro')).toBeNull()
  })

  it('L4：主图本身就是 point-photo 兜底时不再重复传 fallbackSrc；主图另有来源时才传', () => {
    const sameStep = renderCard({ item: item({ payload: null }) })
    expect(screen.getByTestId('resilient-image').getAttribute('data-fallback-src')).toBe('')
    sameStep.unmount()

    renderCard({
      item: item({ payload: { media: { displayUrl: 'https://img.anitabi.cn/a.jpg', source: 'point' } } }),
    })
    expect(screen.getByTestId('resilient-image').getAttribute('data-fallback-src')).toContain(
      '/api/google/point-photo?pointId=115908%3Auji',
    )
  })

  it('三个动作：「查看条目」回调、「导航」与「实景」外链 href', () => {
    const onShowItem = vi.fn()
    renderCard({ onShowItem })

    fireEvent.click(screen.getByRole('button', { name: '查看条目' }))
    expect(onShowItem).toHaveBeenCalledTimes(1)

    expect(screen.getByRole('link', { name: '导航' }).getAttribute('href')).toBe(buildPointNavigationUrl(UJI))
    expect(screen.getByRole('link', { name: '实景' }).getAttribute('href')).toBe(
      'https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=34.889200,135.807500',
    )
    expect(buildStreetViewUrl(UJI)).toBe(
      'https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=34.889200,135.807500',
    )
  })

  it('没有 onShowItem 时不渲染「查看条目」；右上关闭按钮触发 onClose', () => {
    const onClose = vi.fn()
    renderCard({ onClose })
    expect(screen.queryByRole('button', { name: '查看条目' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '关闭' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('条目缺失（快照里找不到 itemId）：仍渲染标题与导航/实景动作', () => {
    renderCard({ item: null })
    expect(screen.getByText('宇治桥')).toBeTruthy()
    expect(screen.getByRole('link', { name: '导航' })).toBeTruthy()
    expect(screen.queryByTestId('resilient-image')).toBeNull()
  })
})
