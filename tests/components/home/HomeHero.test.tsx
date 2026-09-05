import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'

const pushMock = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}))

import HomeHero from '@/components/home/HomeHero'
import { heroDemoItems } from '@/components/home/heroData'
import { heroDemoFixture, mapClustersFixture, showcaseFixture, statsFixture } from './fixtures'
import { clearMatchMediaStub, setPrefersReducedMotion } from './reducedMotion'

function renderHero(locale: 'zh' | 'en' | 'ja' = 'zh') {
  const clusters = mapClustersFixture()
  return render(
    <HomeHero
      locale={locale}
      points={statsFixture.points}
      works={['你的名字。', '孤独摇滚']}
      demo={heroDemoFixture()}
      dots={{ cells: clusters.cells, bbox: clusters.bbox }}
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

  it('点阵背景与作品名滚动条都在首屏里', () => {
    const { container } = renderHero('zh')
    expect(container.querySelectorAll('circle')).toHaveLength(mapClustersFixture().cells.length)
    expect(screen.getAllByText('孤独摇滚').length).toBeGreaterThanOrEqual(1)
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
