import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'

import HomeHeroPhone, { PHONE_STEP_COUNT, PHONE_STEP_MS } from '@/components/home/HomeHeroPhone'
import { heroDemoTransits, heroWalkMinutes } from '@/components/home/heroDemoShape'
import { heroDemoFixture, heroDemoLegacyFixture } from './fixtures'
import { clearMatchMediaStub, setPrefersReducedMotion } from './reducedMotion'

const demo = heroDemoFixture()

const chips = () => document.querySelectorAll('[data-phone-chip]')
const lit = () => document.querySelectorAll('[data-phone-chip][data-lit="true"]')
const pins = () => document.querySelectorAll('[data-phone-pin]')
const shownPins = () => document.querySelectorAll('[data-phone-pin][data-shown="true"]')
const items = () => document.querySelectorAll('[data-phone-item]')
const shownItems = () => document.querySelectorAll('[data-phone-item][data-shown="true"]')
const skeletons = () => document.querySelectorAll('[data-phone-skeleton]')
const shownSkeletons = () => document.querySelectorAll('[data-phone-skeleton][data-shown="true"]')
const transits = () => document.querySelectorAll('[data-phone-transit]')
const shownTransits = () => document.querySelectorAll('[data-phone-transit][data-shown="true"]')

/** 壳内所有元素节点，按文档顺序；用来断言「演示过程中不 mount/unmount」 */
const nodes = () => [...document.querySelectorAll('[data-hero-phone] *')]

function sameNodes(before: Element[], after: Element[]): boolean {
  return before.length === after.length && after.every((node, index) => node === before[index])
}

/** 推进 n 个 700ms 步（t0 是挂载那一刻，所以 step(1) 就是设计里的 t1） */
function step(count = 1) {
  act(() => void vi.advanceTimersByTime(PHONE_STEP_MS * count))
}

describe('HomeHeroPhone（手机壳里的规划师演示）', () => {
  beforeEach(() => {
    setPrefersReducedMotion(false)
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    clearMatchMediaStub()
  })

  it('时序参数按设计：一步 700ms、共 4 步（跑一次停住，不循环）', () => {
    expect(PHONE_STEP_MS).toBe(700)
    expect(PHONE_STEP_COUNT).toBe(4)
  })

  it('t0：外壳与 4 个步骤 chip 就位，只有第 1 个亮；图钉/条目已在 DOM 里但未显示', () => {
    render(<HomeHeroPhone locale="zh" demo={demo} />)

    expect(screen.getByTestId('hero-phone')).toBeInTheDocument()
    expect(chips()).toHaveLength(PHONE_STEP_COUNT)
    expect(lit()).toHaveLength(1)

    // 结构静态：图钉、条目、交通行首帧就全在 DOM 里，只是 data-shown=false
    expect(pins()).toHaveLength(3)
    expect(shownPins()).toHaveLength(0)
    expect(items()).toHaveLength(3)
    expect(shownItems()).toHaveLength(0)
    expect(transits()).toHaveLength(2)
    expect(shownTransits()).toHaveLength(0)
    expect(skeletons()).toHaveLength(3)
    expect(shownSkeletons()).toHaveLength(3)

    // 状态栏固定 09:41，避免 SSR 与客户端时间不一致
    expect(screen.getByText('09:41')).toBeInTheDocument()
  })

  it('浏览器翻译崩溃的根因修复：整段演示不 mount/unmount 任何元素，只切 class', () => {
    render(<HomeHeroPhone locale="zh" demo={demo} />)

    const before = nodes()
    const liCount = document.querySelectorAll('li').length
    const classesBefore = before.map((node) => node.getAttribute('class') ?? '')
    expect(liCount).toBeGreaterThan(0)

    for (let i = 0; i < PHONE_STEP_COUNT + 4; i += 1) {
      step()
      expect(sameNodes(before, nodes())).toBe(true)
      expect(document.querySelectorAll('li').length).toBe(liCount)
    }

    // 只是 class 在变（否则这个断言等于什么都没测）
    expect(nodes().map((node) => node.getAttribute('class') ?? '')).not.toEqual(classesBefore)
  })

  it('手机壳标掉浏览器翻译：translate="no" + data-hero-phone', () => {
    render(<HomeHeroPhone locale="zh" demo={demo} />)

    const shell = screen.getByTestId('hero-phone')
    expect(shell.getAttribute('translate')).toBe('no')
    expect(shell.hasAttribute('data-hero-phone')).toBe(true)
  })

  it('t1：chip2 亮，三个编号图钉显示（每 250ms 一个，用动画延时错开）', () => {
    render(<HomeHeroPhone locale="zh" demo={demo} />)
    step()

    expect(lit()).toHaveLength(2)
    expect(shownPins()).toHaveLength(3)
    expect([...pins()].map((p) => p.getAttribute('data-phone-pin'))).toEqual(['1', '2', '3'])
    expect([...pins()].map((p) => (p as HTMLElement).style.animationDelay)).toEqual(['0ms', '250ms', '500ms'])
    expect(shownItems()).toHaveLength(0)
  })

  it('t2：chip3 亮，地图路线开始画，三条条目显示、骨架隐藏', () => {
    render(<HomeHeroPhone locale="zh" demo={demo} />)
    step(2)

    expect(lit()).toHaveLength(3)
    expect(shownItems()).toHaveLength(3)
    expect(shownSkeletons()).toHaveLength(0)
    expect(screen.getByText('须贺神社男坂')).toBeInTheDocument()
    expect(screen.getByText('09:30')).toBeInTheDocument()
    expect(document.querySelector('[data-phone-route]')!.getAttribute('data-drawing')).toBe('true')
    expect(shownTransits()).toHaveLength(0)
  })

  it('t3：chip4 亮，两条交通行显示，汇总行补上步行总时长，然后停住', () => {
    render(<HomeHeroPhone locale="zh" demo={demo} />)
    step(3)

    expect(lit()).toHaveLength(PHONE_STEP_COUNT)
    expect(shownTransits()).toHaveLength(2)
    expect(screen.getByText('步行 · 约 8 分钟')).toBeInTheDocument()
    expect(screen.getByText('步行 · 约 12 分钟')).toBeInTheDocument()
    // 汇总行：Day 1（演示里固定第一天）· 3 处 · 步行约 20 分钟
    expect(screen.getByTestId('hero-phone-summary').textContent).toBe('Day 1 · 3 处 · 步行约 20 分钟')

    step(6)
    expect(lit()).toHaveLength(PHONE_STEP_COUNT)
    expect(shownItems()).toHaveLength(3)
  })

  it('汇总行在第 4 步之前只有天序与点位数（步行时长是第 4 步补上的）', () => {
    render(<HomeHeroPhone locale="zh" demo={demo} />)
    step(2)
    expect(screen.getByTestId('hero-phone-summary').textContent).toBe('Day 1 · 3 处')
  })

  it('地图块：静态截图 + 编号图钉落在 markers 坐标 + 角落 attribution', () => {
    render(<HomeHeroPhone locale="zh" demo={demo} />)
    step(2)

    const map = screen.getByTestId('hero-phone-map')
    const img = map.querySelector('img')!
    expect(img.getAttribute('src')).toBe('/images/home/hero-phone-map.webp')
    expect(img.getAttribute('width')).toBe('320')
    expect(img.getAttribute('height')).toBe('240')
    expect(img.getAttribute('alt')).toBe('')

    const svg = map.querySelector('svg')!
    expect(svg.getAttribute('viewBox')).toBe('0 0 320 240')
    expect([...pins()].map((p) => [p.getAttribute('data-x'), p.getAttribute('data-y')])).toEqual([
      ['62', '88'],
      ['158', '142'],
      ['246', '74'],
    ])
    expect(map.textContent).toContain('© MapTiler © OpenStreetMap contributors')
  })

  it('条目缩略图固定 40×40、eager、走站内静态路径', () => {
    render(<HomeHeroPhone locale="zh" demo={demo} />)
    step(3)

    const imgs = [...document.querySelectorAll('[data-phone-item] img')]
    expect(imgs).toHaveLength(3)
    for (const img of imgs) {
      expect(img.getAttribute('width')).toBe('40')
      expect(img.getAttribute('height')).toBe('40')
      expect(img.getAttribute('loading')).toBe('eager')
      expect(img.getAttribute('decoding')).toBe('async')
    }
    expect(imgs[0]!.getAttribute('src')).toBe('/images/showcase/h1.jpg')
  })

  it('prefers-reduced-motion 下直接终态（不排定时器）', () => {
    setPrefersReducedMotion(true)
    render(<HomeHeroPhone locale="zh" demo={demo} />)

    expect(lit()).toHaveLength(PHONE_STEP_COUNT)
    expect(shownPins()).toHaveLength(3)
    expect(shownItems()).toHaveLength(3)
    expect(shownSkeletons()).toHaveLength(0)
    expect(shownTransits()).toHaveLength(2)
    expect(document.querySelector('[data-phone-route]')!.getAttribute('data-drawing')).toBe('false')
  })

  it('map 缺省（A 未落盘）时退化为无地图的列表演示，其余照常', () => {
    const legacy = heroDemoLegacyFixture()
    render(<HomeHeroPhone locale="zh" demo={legacy} />)
    step(3)

    expect(screen.queryByTestId('hero-phone-map')).toBeNull()
    expect(shownItems()).toHaveLength(3)
    // 旧形状的 transit 是单个对象，兼容成一条交通行
    expect(shownTransits()).toHaveLength(1)
    expect(screen.getByText('步行 12 分钟')).toBeInTheDocument()
    expect(screen.getByTestId('hero-phone-summary').textContent).toBe('Day 1 · 3 处 · 步行约 12 分钟')
  })

  it('没有演示数据时整块不渲染', () => {
    const { container } = render(<HomeHeroPhone locale="zh" />)
    expect(container.firstChild).toBeNull()

    const empty = render(<HomeHeroPhone locale="zh" demo={{ ...demo, day: { ...demo.day, items: [] } }} />)
    expect(empty.container.firstChild).toBeNull()
  })

  it('步骤 chip 与汇总行三语可读（ja）', () => {
    render(<HomeHeroPhone locale="ja" demo={demo} />)
    step(3)

    expect(screen.getByText('作品を検索')).toBeInTheDocument()
    expect(screen.getByText('交通を確認')).toBeInTheDocument()
    expect(screen.getByTestId('hero-phone-summary').textContent).toBe('Day 1 · 3 か所 · 徒歩 約20分')
  })

  it('条目标题按 locale 取 titles，缺 titles 时退回 title', () => {
    render(<HomeHeroPhone locale="ja" demo={demo} />)
    step(3)

    const titles = [...document.querySelectorAll('[data-phone-title]')].map((el) => el.textContent)
    expect(titles).toEqual(['須賀神社の男坂', '信濃町歩道橋', '四ツ谷見附橋'])
    expect(screen.queryByText('须贺神社男坂')).toBeNull()

    // legacy fixture 没有 titles：任何语言都退回 title
    const legacy = render(<HomeHeroPhone locale="ja" demo={heroDemoLegacyFixture()} />)
    expect([...legacy.container.querySelectorAll('[data-phone-title]')].map((el) => el.textContent)).toEqual([
      '宇治桥',
      '京阪宇治站',
      '大吉山展望台',
    ])
  })

  it('英文 locale 取 titles.en', () => {
    render(<HomeHeroPhone locale="en" demo={demo} />)
    expect([...document.querySelectorAll('[data-phone-title]')].map((el) => el.textContent)).toEqual([
      'Suga Shrine Steps',
      'Shinanomachi Footbridge',
      'Yotsuya Mitsuke Bridge',
    ])
  })
})

describe('heroDemoShape 读取侧工具', () => {
  it('transit 数组 / 单个对象 / 缺省都归一成数组', () => {
    expect(heroDemoTransits(heroDemoFixture())).toHaveLength(2)
    expect(heroDemoTransits(heroDemoLegacyFixture())).toEqual([{ mode: 'walk', label: '步行 12 分钟' }])
    expect(heroDemoTransits(undefined)).toEqual([])
    expect(heroDemoTransits({ planTitle: 'x', day: { dayIndex: 1, summary: '', items: [] } })).toEqual([])
  })

  it('步行总分钟从各段文案里取第一个整数求和，取不到算 0', () => {
    expect(heroWalkMinutes(heroDemoTransits(heroDemoFixture()))).toBe(20)
    expect(heroWalkMinutes([{ mode: 'walk', label: 'no digits' }])).toBe(0)
    expect(heroWalkMinutes([])).toBe(0)
  })
})
