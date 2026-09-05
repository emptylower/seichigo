import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'

import HomeHeroDemo from '@/components/home/HomeHeroDemo'
import { heroDemoFixture } from './fixtures'
import { clearMatchMediaStub, setPrefersReducedMotion } from './reducedMotion'

const demo = heroDemoFixture()

const filled = () => document.querySelectorAll('[data-demo-item]')
const skeletons = () => document.querySelectorAll('[data-demo-skeleton]')

describe('HomeHeroDemo（规划师微演示）', () => {
  beforeEach(() => {
    setPrefersReducedMotion(false)
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    clearMatchMediaStub()
  })

  it('结果卡壳一开始就在：Day 1 徽标 + 三个空行骨架，还没有条目', () => {
    render(<HomeHeroDemo locale="zh" demo={demo} />)

    expect(screen.getByTestId('hero-demo-card')).toBeInTheDocument()
    expect(screen.getByText('Day 1')).toBeInTheDocument()
    expect(filled()).toHaveLength(0)
    expect(skeletons()).toHaveLength(3)
    expect(document.querySelectorAll('[data-lit="true"]')).toHaveLength(0)
  })

  it('步骤逐个点亮，条目按 1→2→3 填入，骨架同步减少', () => {
    render(<HomeHeroDemo locale="zh" demo={demo} />)

    act(() => void vi.advanceTimersByTime(900))
    expect(document.querySelectorAll('[data-lit="true"]')).toHaveLength(1)
    expect(filled()).toHaveLength(1)
    expect(skeletons()).toHaveLength(2)
    expect(screen.getByText('宇治桥')).toBeInTheDocument()

    act(() => void vi.advanceTimersByTime(900))
    expect(filled()).toHaveLength(2)
    expect(skeletons()).toHaveLength(1)

    act(() => void vi.advanceTimersByTime(900))
    expect(filled()).toHaveLength(3)
    expect(skeletons()).toHaveLength(0)
  })

  it('第 4 步点亮后才出现交通线', () => {
    render(<HomeHeroDemo locale="zh" demo={demo} />)

    act(() => void vi.advanceTimersByTime(900 * 3))
    expect(screen.queryByText('步行 12 分钟')).toBeNull()

    act(() => void vi.advanceTimersByTime(900))
    expect(document.querySelectorAll('[data-lit="true"]')).toHaveLength(4)
    expect(screen.getByText('步行 12 分钟')).toBeInTheDocument()
  })

  it('条目带图与时间（固定宽高、eager），只跑一轮停在填满状态', () => {
    render(<HomeHeroDemo locale="zh" demo={demo} />)
    act(() => void vi.advanceTimersByTime(900 * 12))

    expect(document.querySelectorAll('[data-lit="true"]')).toHaveLength(4)
    expect(filled()).toHaveLength(3)
    expect(screen.getByText('09:00')).toBeInTheDocument()

    const imgs = [...screen.getByTestId('hero-demo-card').querySelectorAll('img')]
    expect(imgs).toHaveLength(3)
    for (const img of imgs) {
      expect(img.getAttribute('width')).toBe('48')
      expect(img.getAttribute('height')).toBe('48')
      expect(img.getAttribute('loading')).toBe('eager')
      expect(img.getAttribute('decoding')).toBe('async')
    }
    expect(imgs[0]!.getAttribute('src')).toBe('/images/showcase/h1.jpg')
  })

  it('prefers-reduced-motion 下直接填满并带交通线', () => {
    setPrefersReducedMotion(true)
    render(<HomeHeroDemo locale="zh" demo={demo} />)

    expect(document.querySelectorAll('[data-lit="true"]')).toHaveLength(4)
    expect(filled()).toHaveLength(3)
    expect(skeletons()).toHaveLength(0)
    expect(screen.getByText('步行 12 分钟')).toBeInTheDocument()
  })

  it('交通文案缺省时回退到 i18n 文案', () => {
    const withoutLabel = { ...demo, day: { ...demo.day, transit: { mode: 'walk', label: '' } } }
    render(<HomeHeroDemo locale="ja" demo={withoutLabel} />)
    act(() => void vi.advanceTimersByTime(900 * 4))

    expect(screen.getByText('徒歩 12 分')).toBeInTheDocument()
  })

  it('没有演示数据（A 部分未落盘）时整块不渲染', () => {
    const { container } = render(<HomeHeroDemo locale="zh" />)
    expect(container.firstChild).toBeNull()

    const empty = render(<HomeHeroDemo locale="zh" demo={{ ...demo, day: { ...demo.day, items: [] } }} />)
    expect(empty.container.firstChild).toBeNull()
  })
})
