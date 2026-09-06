import { readFileSync } from 'node:fs'
import path from 'node:path'
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

  it('三个入口卡只由首屏渲染一次（不再单独成段重复出现）', () => {
    render(<HomePageTemplate locale="zh" data={portalDataFixture()} />)

    expect(screen.getAllByRole('link', { name: /AI 行程规划/ })).toHaveLength(1)
    expect(screen.getAllByRole('link', { name: /地图探索/ })).toHaveLength(1)
    // 「巡礼攻略」四个字在攻略段里也有，这里用入口卡自己的描述句定位
    expect(screen.getAllByRole('link', { name: /读一遍别人走过的路线再出发/ })).toHaveLength(1)
  })

  it('滚动提示指向第二屏，且第二屏 section 带 id="home-showcase"', () => {
    const { container } = render(<HomePageTemplate locale="zh" data={portalDataFixture()} />)

    expect(screen.getByRole('link', { name: '向下看看' })).toHaveAttribute('href', '#home-showcase')
    expect(container.querySelector('section#home-showcase')).not.toBeNull()
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

describe('HomePageTemplate（第十三轮第二批：通栏与顶部空白）', () => {
  it('根元素同时声明 data-layout-wide 与 data-layout-flush（壳去掉 max-w 与顶部内边距）', () => {
    const { container } = render(<HomePageTemplate locale="zh" data={portalDataFixture()} />)
    const root = container.firstElementChild as HTMLElement

    expect(root.getAttribute('data-layout-wide')).toBe('true')
    expect(root.getAttribute('data-layout-flush')).toBe('true')
  })

  it('JSON-LD 的 <script> 不再是根元素的第一个子节点（否则 space-y 会在首屏上方留 64px 空白）', () => {
    const { container } = render(<HomePageTemplate locale="zh" data={portalDataFixture()} />)
    const root = container.firstElementChild as HTMLElement
    const children = [...root.children]

    expect(children[0]!.tagName).toBe('SECTION')
    expect(children.findIndex((el) => el.tagName === 'SCRIPT')).toBe(children.length - 1)
    // 根元素自己不再用 space-y 撑开各段（首屏必须紧贴页眉）
    expect(root.className).not.toMatch(/(^|\s)space-y-/)
  })

  it('首屏通栏、其余各段收在与上线版本同宽的 max-w-5xl 容器里', () => {
    const { container } = render(<HomePageTemplate locale="zh" data={portalDataFixture()} />)
    const root = container.firstElementChild as HTMLElement
    const hero = root.querySelector('section')!
    const sections = root.querySelector('[data-home-sections]') as HTMLElement

    expect(sections).not.toBeNull()
    expect(sections.className).toContain('max-w-5xl')
    expect(sections.className).toContain('px-4')
    expect(sections.className).toContain('space-y-12')
    // 首屏在容器之外 → 直接通栏
    expect(sections.contains(hero)).toBe(false)
    expect(sections.querySelector('#home-showcase')).not.toBeNull()
  })

  it('第十四轮：不再向首屏传点阵（dots），背景换成插画 <picture>', () => {
    const { container } = render(<HomePageTemplate locale="zh" data={portalDataFixture()} />)
    const hero = container.querySelector('section')!

    expect(hero.querySelector('[data-testid="hero-backdrop"]')).toBeNull()
    expect(hero.querySelectorAll('[data-hero-glow]')).toHaveLength(0)
    const picture = hero.querySelector('[data-testid="hero-background"] picture')!
    expect(picture.querySelectorAll('source')).toHaveLength(4)
    expect(hero.querySelector('img[fetchpriority="high"]')!.getAttribute('src')).toContain('/images/home/hero-bg-')
  })

  it('globals.css 里有 data-layout-flush 的去顶部内边距规则', () => {
    const css = readFileSync(path.join(process.cwd(), 'styles/globals.css'), 'utf8')
    const rule = /\.site-shell-public:has\(\[data-layout-flush='true'\]\)\s*>\s*\.site-shell-public__main\s*\{[^}]*padding-top:\s*0/
    expect(css).toMatch(rule)
  })
})
