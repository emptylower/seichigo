import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

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
vi.mock('maplibre-gl', () => {
  class FakeMap {
    constructor(public options: Record<string, unknown>) {}
    on() {}
    off() {}
    addSource() {}
    getSource() {
      return undefined
    }
    addLayer() {}
    getLayer() {
      return undefined
    }
    fitBounds() {}
    remove() {}
  }
  return { default: { Map: FakeMap } }
})

import HomePageTemplate from '@/components/home/HomePageTemplate'
import { portalDataFixture } from './fixtures'

function positionOf(text: string): number {
  return document.body.textContent?.indexOf(text) ?? -1
}

describe('HomePageTemplate（第十二轮信息架构）', () => {
  it('按规划师主线排列各段：输入框 → 入口卡 → 展示计划 → 地图 → 攻略 → 浏览 → FAQ', () => {
    render(<HomePageTemplate locale="zh" data={portalDataFixture()} />)

    expect(screen.getByPlaceholderText('例如：圣诞周去东京 8 天，想巡礼《天气之子》和《你的名字》')).toBeInTheDocument()

    const order = ['AI 行程规划', '看看规划师做出来的行程', '全球 128,456 个巡礼点位', '按作品和城市浏览']
    const positions = order.map(positionOf)
    expect(positions.every((p) => p >= 0)).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
  })

  it('保留 FAQ 与其 JSON-LD', () => {
    const { container } = render(<HomePageTemplate locale="zh" data={portalDataFixture()} />)

    expect(container.querySelector('script[type="application/ld+json"]')).not.toBeNull()
    expect(screen.getByRole('heading', { name: '常见问题' })).toBeInTheDocument()
  })

  it('不再渲染 App 预告段、路线枢纽与新手三步', () => {
    render(<HomePageTemplate locale="zh" data={portalDataFixture()} />)

    expect(screen.queryByText('SeichiGo App')).toBeNull()
    expect(screen.queryByText('Coming Soon')).toBeNull()
    expect(screen.queryByRole('heading', { name: '路线规划中心' })).toBeNull()
    expect(screen.queryByRole('heading', { name: '新手出发' })).toBeNull()
  })

  it('A 部分数据缺失时降级为不渲染对应段，页面仍可用', () => {
    render(
      <HomePageTemplate
        locale="zh"
        data={portalDataFixture({ stats: undefined, showcase: undefined, mapClusters: undefined, guides: [] })}
      />,
    )

    expect(screen.getByPlaceholderText('例如：圣诞周去东京 8 天，想巡礼《天气之子》和《你的名字》')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '看看规划师做出来的行程' })).toBeNull()
    expect(screen.getByRole('heading', { name: '按作品和城市浏览' })).toBeInTheDocument()
  })
})
