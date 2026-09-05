import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, fireEvent } from '@testing-library/react'
import type { MutableRefObject } from 'react'

/** 每个 RoutePreviewMap 实例（inline / 展开态）各记一份 props：L2 要求两者互不干扰 */
type MapProps = {
  interactive?: boolean
  renderPopup?: (id: string) => HTMLElement | null
  onPopupClosed?: (id: string) => void
  popupControlsRef?: MutableRefObject<{ close: () => void } | null>
}
const mapState = vi.hoisted(() => ({
  instances: [] as MapProps[],
  /** 展开态地图的 popupControlsRef.close 桩：断言点位卡关闭走的是地图暴露的入口 */
  closeSpy: vi.fn(),
}))
vi.mock('@/components/route/RoutePreviewMap', () => ({
  RoutePreviewMap: (props: MapProps) => {
    mapState.instances.push(props)
    if (props.popupControlsRef) props.popupControlsRef.current = { close: mapState.closeSpy }
    return <div data-testid="route-map" data-interactive={String(props.interactive ?? true)} />
  },
}))
vi.mock('@/components/map/ResilientMapImage', () => ({
  default: (props: { src: string | null; alt: string }) => (
    <img data-testid="resilient-image" data-src={props.src ?? ''} alt={props.alt} />
  ),
}))

import { DayMap } from '@/app/(authed)/plan/[id]/components/DayMap'
import type { TripPlanDayView, TripPlanItemView } from '@/lib/tripPlan/view'

const UJI_KEY = 'point|115908:uji|宇治桥'
const NARA_KEY = 'point|115908:nara|奈良公园'

function pointItem(id: string, pointId: string, title: string, lat: number, lng: number): TripPlanItemView {
  return {
    id,
    sortOrder: 0,
    type: 'point',
    pointId,
    timeHint: null,
    title,
    note: null,
    reason: null,
    payload: null,
    point: { id: pointId, name: title, nameZh: title, lat, lng, image: null },
  } as TripPlanItemView
}

/** 单点的一天：dayPoints.length < 2 → DayMap 不请求路线几何（无需 stub fetch） */
function day(index: number, item: TripPlanItemView): TripPlanDayView {
  return { id: `day-${index}`, dayIndex: index, date: null, citySlug: null, summary: null, items: [item] }
}

const DAY_ONE = day(1, pointItem('i1', '115908:uji', '宇治桥', 34.8892, 135.8075))
const DAY_TWO = day(2, pointItem('i2', '115908:nara', '奈良公园', 34.685, 135.843))

/** 最后一次渲染的 inline 地图（展开态在 DayMap 之后渲染，取列表倒数第二个） */
function inlineMap(): MapProps {
  return mapState.instances.filter((p) => p.interactive === false).at(-1)!
}
function expandedMap(): MapProps {
  return mapState.instances.filter((p) => p.interactive !== false).at(-1)!
}

function openPopup(map: MapProps, id: string): HTMLElement {
  let el!: HTMLElement
  act(() => {
    el = map.renderPopup!(id)!
  })
  return el
}

beforeEach(() => {
  mapState.instances = []
  mapState.closeSpy = vi.fn()
})

describe('DayMap 点位卡宿主生命周期（H3 / L1 / L2）', () => {
  it('H3：Popup 被地图关掉（onPopupClosed）后卡片卸载，同一点再次 renderPopup 拿到新容器', () => {
    render(<DayMap planId="plan-1" day={DAY_ONE} />)
    const first = openPopup(inlineMap(), UJI_KEY)
    expect(first.textContent).toContain('宇治桥')

    act(() => {
      inlineMap().onPopupClosed!(UJI_KEY)
    })
    expect(first.textContent).toBe('')

    const second = openPopup(inlineMap(), UJI_KEY)
    expect(second).not.toBe(first)
    expect(second.textContent).toContain('宇治桥')
  })

  it('H3：onPopupClosed 带的是已被顶掉的旧点 id 时不误清当前卡片', () => {
    render(<DayMap planId="plan-1" day={DAY_ONE} />)
    const host = openPopup(inlineMap(), UJI_KEY)
    act(() => {
      inlineMap().onPopupClosed!('point|other|别处')
    })
    expect(host.textContent).toContain('宇治桥')
  })

  it('L1：卡片右上「关闭」→ 撤掉宿主并调用地图暴露的关闭入口（不模拟点击 maplibre 关闭按钮）', () => {
    render(<DayMap planId="plan-1" day={DAY_ONE} />)
    const host = openPopup(inlineMap(), UJI_KEY)
    const closeButton = Array.from(host.querySelectorAll('button')).find(
      (el) => el.getAttribute('aria-label') === '关闭',
    )!
    act(() => {
      fireEvent.click(closeButton)
    })
    expect(host.textContent).toBe('')
    expect(mapState.closeSpy).toHaveBeenCalledTimes(1)
  })

  it('L2：inline 与展开态各持一份宿主——展开态开卡片不顶掉 inline 已开的卡片', () => {
    render(<DayMap planId="plan-1" day={DAY_ONE} />)
    const inlineHost = openPopup(inlineMap(), UJI_KEY)
    fireEvent.click(screen.getByRole('button', { name: '展开' }))
    const expandedHost = openPopup(expandedMap(), UJI_KEY)

    expect(expandedHost).not.toBe(inlineHost)
    expect(expandedHost.textContent).toContain('宇治桥')
    expect(inlineHost.textContent).toContain('宇治桥')

    // 关掉展开态的卡片只影响展开态那一份
    act(() => {
      expandedMap().onPopupClosed!(UJI_KEY)
    })
    expect(expandedHost.textContent).toBe('')
    expect(inlineHost.textContent).toContain('宇治桥')
  })

  it('L2：切天后卡片卸载（宿主里不再残留上一天的点位卡）', () => {
    const { rerender } = render(<DayMap planId="plan-1" day={DAY_ONE} />)
    const host = openPopup(inlineMap(), UJI_KEY)
    expect(host.textContent).toContain('宇治桥')

    rerender(<DayMap planId="plan-1" day={DAY_TWO} />)
    expect(host.textContent).toBe('')
    // 新的一天可以正常开卡片
    const next = openPopup(inlineMap(), NARA_KEY)
    expect(next.textContent).toContain('奈良公园')
  })
})
