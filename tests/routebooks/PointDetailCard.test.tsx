import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import { PointDetailCard } from '@/app/(authed)/me/routebooks/[id]/components/PointDetailCard'
import type {
  DayRecord,
  ItemRecord,
  PlaceRecord,
  PointPreview,
} from '@/app/(authed)/me/routebooks/[id]/types'

function jsonResponse(data: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => data } as Response
}

const DAYS: DayRecord[] = [
  { id: 'day1', routeBookId: 'rb1', dayIndex: 1, date: null, title: null, defaultTravelMode: 'transit' },
  { id: 'day2', routeBookId: 'rb1', dayIndex: 2, date: null, title: null, defaultTravelMode: 'transit' },
]

function makePointItem(overrides: Partial<ItemRecord> = {}): ItemRecord {
  return {
    id: 'item-point-1',
    routeBookId: 'rb1',
    dayId: 'day1',
    sortOrder: 0,
    kind: 'point',
    pointId: '115908:uji桥',
    placeId: null,
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

function makePlaceItem(overrides: Partial<ItemRecord> = {}): ItemRecord {
  return makePointItem({
    id: 'item-place-1',
    kind: 'place',
    pointId: null,
    placeId: 'place-1',
    ...overrides,
  })
}

function makePlace(overrides: Partial<PlaceRecord> = {}): PlaceRecord {
  return {
    id: 'place-1',
    routeBookId: 'rb1',
    kind: 'restaurant',
    title: '宇治川茶屋',
    address: '京都府宇治市宇治1-2-3',
    lat: 34.8892,
    lng: 135.8075,
    note: null,
    googlePlaceId: 'ChIJxxxxxxxx',
    createdAt: '2026-09-23T00:00:00.000Z',
    ...overrides,
  }
}

const POINT_PREVIEW: PointPreview = {
  title: '宇治桥',
  subtitle: '凉宫春日的忧郁',
  image: 'https://example.com/uji.jpg',
  geo: [34.8892, 135.8075],
}

function renderCard(props: Partial<Parameters<typeof PointDetailCard>[0]> = {}) {
  const onClose = vi.fn()
  const onDelete = vi.fn()
  const onMoveItem = vi.fn()
  const item = props.item ?? makePointItem()
  const place = props.place ?? null
  const preview = props.preview === undefined ? POINT_PREVIEW : props.preview
  render(
    <PointDetailCard
      routeBookId="rb1"
      item={item}
      preview={preview}
      place={place}
      days={DAYS}
      lang="zh-CN"
      onClose={onClose}
      onDelete={onDelete}
      onMoveItem={onMoveItem}
      {...props}
    />
  )
  return { onClose, onDelete, onMoveItem }
}

describe('PointDetailCard（B4 点位详情卡）', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('作品点位：渲染图片、名称、作品名，不调 intro 接口', async () => {
    renderCard()

    expect(screen.getByText('宇治桥')).toBeInTheDocument()
    expect(screen.getByText('凉宫春日的忧郁')).toBeInTheDocument()
    const img = document.querySelector('img')
    expect(img).not.toBeNull()
    expect(img?.getAttribute('src')).toBe('https://example.com/uji.jpg')
    expect(screen.getByRole('link', { name: /在巡礼地图查看/ })).toHaveAttribute(
      'href',
      `/map?p=${encodeURIComponent('115908:uji桥')}`
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('作品点位：无图时用渐变占位（不渲染 <img>）', () => {
    renderCard({ preview: { ...POINT_PREVIEW, image: null } })
    expect(document.querySelector('img')).toBeNull()
    expect(screen.getByText('暂无截图')).toBeInTheDocument()
  })

  it('自定义点：拉取并渲染谷歌介绍，且不放图', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        intro: {
          name: '宇治川茶屋',
          address: '京都府宇治市宇治1-2-3',
          rating: 4.3,
          userRatingsTotal: 1234,
          summary: '抹茶与庭园都很出色的小店。',
          openingHours: ['周一: 10:00–18:00', '周二: 10:00–18:00'],
          website: 'https://example.com',
          mapsUrl: 'https://maps.google.com/?cid=xxx',
        },
      })
    )

    renderCard({ item: makePlaceItem(), place: makePlace(), preview: null })

    // 请求发出
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const calledUrl = String(fetchMock.mock.calls[0]?.[0])
    expect(calledUrl).toContain('/api/me/routebooks/rb1/places/place-1/intro')
    expect(calledUrl).toContain('lang=zh-CN')

    // 不放图
    expect(document.querySelector('img')).toBeNull()
    // 评分 / 简介
    expect(await screen.findByText('★ 4.3 · 1,234 条')).toBeInTheDocument()
    expect(screen.getByText('抹茶与庭园都很出色的小店。')).toBeInTheDocument()
    // 营业时间默认折叠，点击展开
    expect(screen.queryByText('周一: 10:00–18:00')).not.toBeInTheDocument()
    act(() => {
      screen.getByRole('button', { name: /营业时间/ }).click()
    })
    expect(screen.getByText('周一: 10:00–18:00')).toBeInTheDocument()
    // 网站 + Google 地图
    expect(screen.getByRole('link', { name: /网站/ })).toHaveAttribute('href', 'https://example.com')
    expect(screen.getByRole('link', { name: /在 Google 地图打开/ })).toHaveAttribute(
      'href',
      'https://maps.google.com/?cid=xxx'
    )
  })

  it('自定义点：404 显示「暂无谷歌信息」占位', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: '该地点暂无谷歌信息' }, false, 404))

    renderCard({ item: makePlaceItem(), place: makePlace(), preview: null })

    expect(await screen.findByText('暂无谷歌信息')).toBeInTheDocument()
    expect(document.querySelector('img')).toBeNull()
  })

  it('点关闭按钮触发 onClose；「从当天移除」触发 onDelete', () => {
    const { onClose, onDelete } = renderCard()

    act(() => {
      screen.getByRole('button', { name: '关闭' }).click()
    })
    expect(onClose).toHaveBeenCalledTimes(1)

    act(() => {
      screen.getByRole('button', { name: '从当天移除' }).click()
    })
    expect(onDelete).toHaveBeenCalledTimes(1)
  })
})
