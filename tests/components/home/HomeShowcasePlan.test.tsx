import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))
vi.mock('@/components/route/RoutePreviewMap', () => ({
  RoutePreviewMap: () => <div data-testid="route-map" />,
}))
vi.mock('@/components/map/ResilientMapImage', () => ({
  default: (props: { src: string | null; alt: string }) => (
    <div data-testid="resilient-image" data-src={props.src ?? ''} aria-label={props.alt} />
  ),
}))

import HomeShowcasePlan from '@/components/home/HomeShowcasePlan'
import { showcaseFixture } from './fixtures'

describe('HomeShowcasePlan', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'))
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('展示计划只读渲染：没有保存/调整入口，也没有历史快照标签', () => {
    render(<HomeShowcasePlan locale="zh" showcase={showcaseFixture()} />)

    expect(screen.getByRole('heading', { name: '看看规划师做出来的行程' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '用规划师做一份我的' })).toHaveAttribute('href', '/plan/start')
    expect(screen.queryByRole('button', { name: '保存到我的地图' })).toBeNull()
    expect(screen.queryByText('历史快照 · 只读')).toBeNull()
    expect(screen.queryByText(/交给规划师调整/)).toBeNull()
    expect(screen.getByText('新宿到代代木的取景地')).toBeInTheDocument()
  })

  it('Day 标签每 5 秒自动轮播', () => {
    render(<HomeShowcasePlan locale="zh" showcase={showcaseFixture()} />)

    expect(screen.getByText('新宿到代代木的取景地')).toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(screen.getByText('田端与荒川沿线')).toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(screen.getByText('台场一日')).toBeInTheDocument()
  })

  it('用户点过 Day 标签后停止轮播', () => {
    render(<HomeShowcasePlan locale="zh" showcase={showcaseFixture()} />)

    fireEvent.click(screen.getByRole('button', { name: /Day 3/ }))
    expect(screen.getByText('台场一日')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(20000)
    })
    expect(screen.getByText('台场一日')).toBeInTheDocument()
  })

  it('低-6：en/ja 的 CTA 带 ?locale=，zh 不带', () => {
    const zh = render(<HomeShowcasePlan locale="zh" showcase={showcaseFixture()} />)
    expect(screen.getByRole('link', { name: '用规划师做一份我的' })).toHaveAttribute('href', '/plan/start')
    zh.unmount()

    render(<HomeShowcasePlan locale="ja" showcase={showcaseFixture()} />)
    expect(screen.getByRole('link', { name: '自分の行程をプランナーで作る' })).toHaveAttribute(
      'href',
      '/plan/start?locale=ja',
    )
  })

  it('中-11：餐饮/住宿条目的 media 图与署名都渲染出来', () => {
    render(<HomeShowcasePlan locale="zh" showcase={showcaseFixture()} />)

    const srcs = [...document.querySelectorAll('img')].map((el) => el.getAttribute('src'))
    expect(srcs).toContain('/api/google/place-photo?ref=mealREF')
    expect(screen.getByText('照片：Kenji Sato')).toBeInTheDocument()
  })

  it('第二屏首帧：静态模式用原生 img（固定宽高、eager），不再走 ResilientMapImage', () => {
    render(<HomeShowcasePlan locale="zh" showcase={showcaseFixture()} />)

    expect(screen.queryAllByTestId('resilient-image')).toHaveLength(0)
    const imgs = [...document.querySelectorAll('img')]
    expect(imgs.length).toBeGreaterThan(0)
    expect(imgs[0]!.getAttribute('width')).toBe('96')
    expect(imgs[0]!.getAttribute('loading')).toBe('eager')
  })

  it('预载 Day 1 的前几张图（ReactDOM.preload）', () => {
    render(<HomeShowcasePlan locale="zh" showcase={showcaseFixture()} />)

    const preloaded = [...document.querySelectorAll('link[rel="preload"][as="image"]')].map((el) =>
      el.getAttribute('href'),
    )
    expect(preloaded).toContain('/api/google/place-photo?ref=mealREF')
  })

  it('静态渲染不预取路线（不发任何请求）', () => {
    render(<HomeShowcasePlan locale="zh" showcase={showcaseFixture()} />)
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })
})
