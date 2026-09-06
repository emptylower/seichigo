import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'

const pushMock = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}))

import HomeHero from '@/components/home/HomeHero'
import { heroDemoItems } from '@/components/home/heroData'
import { heroDemoFixture, showcaseFixture, statsFixture } from './fixtures'
import { clearMatchMediaStub, setPrefersReducedMotion } from './reducedMotion'

function renderHero(locale: 'zh' | 'en' | 'ja' = 'zh') {
  return render(
    <HomeHero
      locale={locale}
      points={statsFixture.points}
      works={['你的名字。', '孤独摇滚']}
      demo={heroDemoFixture()}
      stats={statsFixture}
    />,
  )
}

describe('HomeHero', () => {
  beforeEach(() => {
    pushMock.mockReset()
    setPrefersReducedMotion(false)
  })
  afterEach(() => clearMatchMediaStub())

  it('SEO：H1 三语都含「圣地巡礼」关键词', () => {
    const zh = renderHero('zh')
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('圣地巡礼')
    zh.unmount()

    const en = renderHero('en')
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('Anime pilgrimage')
    en.unmount()

    renderHero('ja')
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('聖地巡礼')
  })

  it('副标题里的 {points} 取整到万位，并渲染品牌小字', () => {
    renderHero('zh')
    expect(screen.getByText(/全球 13 万\+ 巡礼点位地图/)).toBeInTheDocument()
    expect(screen.getByText('SeichiGo 圣地GO · 动漫圣地巡礼')).toBeInTheDocument()
  })

  it('没有 stats 时副标题去掉点位数那句而不是渲染出 {points}', () => {
    render(<HomeHero locale="zh" />)
    expect(document.body.textContent).not.toContain('{points}')
  })

  it('打字机占位随时间推进，聚焦后回到静态占位', () => {
    vi.useFakeTimers()
    try {
      renderHero('zh')
      const input = screen.getByRole('textbox')
      const staticPlaceholder = '例如：圣诞周去东京 8 天，想巡礼《天气之子》和《你的名字》'

      act(() => void vi.advanceTimersByTime(45 * 2))
      const typing = input.getAttribute('placeholder') ?? ''
      expect(typing.length).toBe(2)

      fireEvent.focus(input)
      expect(input.getAttribute('placeholder')).toBe(staticPlaceholder)
    } finally {
      vi.useRealTimers()
    }
  })

  it('prefers-reduced-motion 下占位直接显示第一条示例', () => {
    setPrefersReducedMotion(true)
    renderHero('zh')
    expect(screen.getByRole('textbox').getAttribute('placeholder')).toBe(
      '圣诞周去东京 8 天，想巡礼《天气之子》和《你的名字》',
    )
  })

  it('插画背景与路线层铺在首屏最底下，点阵与光斑已经不在了', () => {
    const { container } = renderHero('zh')

    expect(screen.getByTestId('hero-background')).toBeInTheDocument()
    expect(container.querySelector('[data-hero-route]')).not.toBeNull()
    expect(container.querySelector('[data-testid="hero-backdrop"]')).toBeNull()
    expect(container.querySelectorAll('[data-hero-glow]')).toHaveLength(0)
    expect(container.querySelectorAll('[data-hero-dots-box]')).toHaveLength(0)
    expect(screen.getAllByText('孤独摇滚').length).toBeGreaterThanOrEqual(1)
  })

  it('标题拆成两段：{accent} 用品牌色，`，`后在 lg 强制换行', () => {
    const cases = [
      ['zh', 'AI 规划师', '动漫圣地巡礼行程，AI 规划师帮你排好'],
      ['en', 'planned by an AI planner', 'Anime pilgrimage itineraries, planned by an AI planner'],
      ['ja', 'AIプランナー', 'アニメ聖地巡礼の旅程を、AIプランナーが組み立てる'],
    ] as const

    for (const [locale, accent, whole] of cases) {
      const view = renderHero(locale)
      const h1 = screen.getByRole('heading', { level: 1 })

      expect(h1.textContent).toBe(whole)
      const accentEl = h1.querySelector('[data-hero-accent]') as HTMLElement
      expect(accentEl.textContent).toBe(accent)
      expect(accentEl.className).toContain('text-brand-600')
      // 换行只在桌面生效，移动端仍按容器宽度自然折行
      const br = h1.querySelector('br')!
      expect(br.getAttribute('class')).toBe('hidden lg:block')
      expect(h1.className).toContain('lg:text-5xl')
      view.unmount()
    }
  })

  it('slogan 排在入口卡与滚动提示之间，只在 lg 以上显示', () => {
    const { container } = renderHero('zh')
    const slogan = container.querySelector('[data-hero-slogan]') as HTMLElement

    expect(slogan.textContent).toContain('动漫迷做给动漫迷的圣地巡礼平台')
    expect(slogan.className).toContain('hidden')
    expect(slogan.className).toContain('lg:flex')
    expect(slogan.className).toContain('text-sm')
    expect(slogan.className).toContain('tracking-wide')
    expect(slogan.className).toContain('text-gray-500')

    const footer = container.querySelector('[data-hero-footer]')!
    const nodes = [...footer.children]
    const cardsIndex = nodes.findIndex((el) => el.querySelector('a[href="/plan/start"]'))
    const sloganIndex = nodes.indexOf(slogan)
    const hintIndex = nodes.findIndex((el) => el.getAttribute('href') === '#home-showcase')
    expect(cardsIndex).toBeLessThan(sloganIndex)
    expect(sloganIndex).toBeLessThan(hintIndex)
  })

  it('slogan 两侧各一枝镜像的月桂枝，不再用 ❝❞ 文字符号', () => {
    const { container } = renderHero('zh')
    const slogan = container.querySelector('[data-hero-slogan]') as HTMLElement

    expect(slogan.textContent).not.toContain('❝')
    expect(slogan.textContent).not.toContain('❞')

    const laurels = [...slogan.querySelectorAll('[data-hero-laurel]')]
    expect(laurels).toHaveLength(2)
    for (const laurel of laurels) {
      expect(laurel.getAttribute('aria-hidden')).toBe('true')
      expect(laurel.getAttribute('class')).toContain('text-gray-400')
    }
    // 右侧那枝是左侧的镜像
    expect(laurels[0]!.querySelector('g')!.getAttribute('transform')).toBeNull()
    expect(laurels[1]!.querySelector('g')!.getAttribute('transform')).toContain('scale(-1, 1)')

    // 与上面的入口卡之间留 20px
    expect(slogan.className).toContain('mt-5')
  })

  it('手机演示替换了原来的演示卡（外壳 + 步骤 chip 在首屏右栏）', () => {
    renderHero('zh')
    expect(screen.getByTestId('hero-phone')).toBeInTheDocument()
    expect(document.querySelectorAll('[data-phone-chip]')).toHaveLength(4)
  })

  it('首屏锁一整屏：section 用 lg:min-h-[calc(100svh-var(--site-header-h))] 且纵向 flex', () => {
    const { container } = renderHero('zh')
    const section = container.querySelector('section')!
    expect(section.className).toContain('flex')
    expect(section.className).toContain('flex-col')
    expect(section.className).toContain('lg:min-h-[calc(100svh-var(--site-header-h))]')
  })

  it('首屏内容容器统一 max-w-5xl，与下面各段同宽（不再是 6xl）', () => {
    const { container } = renderHero('zh')
    const section = container.querySelector('section')!

    const grid = section.querySelector('[data-hero-main]') as HTMLElement
    const footerRow = section.querySelector('[data-hero-footer]') as HTMLElement
    expect(grid).not.toBeNull()
    expect(footerRow).not.toBeNull()
    for (const box of [grid, footerRow]) {
      expect(box.className).toContain('max-w-5xl')
      expect(box.className).toContain('mx-auto')
      expect(box.className).toContain('px-4')
    }
    expect(section.innerHTML).not.toContain('max-w-6xl')
  })

  it('传入 stats 时首屏底部收尾出现三个入口链接', () => {
    renderHero('zh')
    expect(screen.getByRole('link', { name: /AI 行程规划/ })).toHaveAttribute('href', '/plan/start')
    expect(screen.getByRole('link', { name: /地图探索/ })).toHaveAttribute('href', '/map')
    expect(screen.getByRole('link', { name: /巡礼攻略/ })).toHaveAttribute('href', '/posts')
    expect(screen.getByText('128,456 个巡礼点位')).toBeInTheDocument()
  })

  it('入口卡下方是指向第二屏的滚动提示（lg 以上显示）', () => {
    renderHero('zh')
    const hint = screen.getByRole('link', { name: '向下看看' })
    expect(hint).toHaveAttribute('href', '#home-showcase')
    expect(hint.className).toContain('lg:')
  })

  it('没有演示数据时背景仍在，首屏仍可用', () => {
    render(<HomeHero locale="zh" />)
    expect(screen.getByTestId('hero-background')).toBeInTheDocument()
    expect(screen.queryByTestId('hero-phone')).toBeNull()
    expect(screen.getByRole('textbox')).toBeInTheDocument()
  })

  it('提交后带 draft 跳到非本地化的 /plan/start（低-6：ja 带 locale）', () => {
    renderHero('ja')
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '東京 5 日間' } })
    fireEvent.click(screen.getByRole('button', { name: 'プランを作る' }))

    expect(pushMock).toHaveBeenCalledWith(`/plan/start?draft=${encodeURIComponent('東京 5 日間')}&locale=ja`)
  })

  it('中-2：输入法组词中的回车不提交', () => {
    renderHero('zh')
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: '京都 3 天' } })

    expect(fireEvent.keyDown(input, { key: 'Enter', isComposing: true })).toBe(false)
    expect(pushMock).not.toHaveBeenCalled()
    expect(fireEvent.keyDown(input, { key: 'Enter' })).toBe(true)
  })

  it('点示例 chip 填入输入框，空输入不跳转', () => {
    renderHero('zh')

    fireEvent.click(screen.getByRole('button', { name: '开始规划' }))
    expect(pushMock).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '周末两天在镰仓，巡礼《灌篮高手》' }))
    expect(screen.getByRole('textbox')).toHaveValue('周末两天在镰仓，巡礼《灌篮高手》')

    fireEvent.submit(screen.getByRole('form', { name: '开始规划' }))
    expect(pushMock).toHaveBeenCalledWith(`/plan/start?draft=${encodeURIComponent('周末两天在镰仓，巡礼《灌篮高手》')}`)
  })
})

describe('heroDemoItems', () => {
  it('取 Day 1 前 3 条带图条目（标题、时间、缩略图）', () => {
    expect(heroDemoItems(showcaseFixture().days)).toEqual([
      { id: 'm1', title: '新宿 · 一兰拉面', time: null, image: '/api/google/place-photo?ref=mealREF' },
    ])
  })

  it('没有 days 时返回空数组', () => {
    expect(heroDemoItems(undefined)).toEqual([])
  })
})
