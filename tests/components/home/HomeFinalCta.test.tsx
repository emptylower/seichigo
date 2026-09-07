import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}))

import HomeFinalCta from '@/components/home/HomeFinalCta'
import { statsFixture } from './fixtures'

describe('HomeFinalCta（收尾行动区）', () => {
  beforeEach(() => {
    push.mockClear()
  })

  it('大标题三个词是粉色片段，拼回完整标题', () => {
    render(<HomeFinalCta locale="zh" stats={statsFixture} />)

    const accents = [...document.querySelectorAll('[data-final-cta-accent]')]
    expect(accents.map((el) => el.textContent)).toEqual(['作品', '假期', '规划师'])
    for (const el of accents) expect(el.className).toContain('text-brand-600')
    expect(accents[0]!.closest('h2')!.textContent).toBe('说出作品和假期，规划师帮你排好')
  })

  it('提交带草稿跳转 planStartHref；空输入不跳', () => {
    render(<HomeFinalCta locale="zh" stats={statsFixture} />)

    const input = screen.getByPlaceholderText('圣诞周去东京 8 天，想巡礼《天气之子》和《你的名字》')
    const form = input.closest('form')!
    fireEvent.change(input, { target: { value: '  镰仓两天  ' } })
    fireEvent.submit(form)
    expect(push).toHaveBeenCalledWith('/plan/start?draft=%E9%95%B0%E4%BB%93%E4%B8%A4%E5%A4%A9')

    push.mockClear()
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.submit(form)
    expect(push).not.toHaveBeenCalled()
  })

  it('en locale 跳转带 locale query', () => {
    render(<HomeFinalCta locale="en" stats={statsFixture} />)

    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'Kamakura weekend' } })
    fireEvent.submit(input.closest('form')!)
    expect(push).toHaveBeenCalledWith('/plan/start?draft=Kamakura%20weekend&locale=en')
  })

  it('底部统计行：points 取整 + 真实 works，两侧各一枝月桂枝', () => {
    render(<HomeFinalCta locale="zh" stats={statsFixture} />)

    expect(screen.getByText('全球 13 万+ 巡礼点位 · 1,234+ 动漫作品 · 你的专属行程')).toBeInTheDocument()
    expect(document.querySelectorAll('[data-hero-laurel]')).toHaveLength(2)
  })

  it('stats 缺失时只显示「你的专属行程」小节', () => {
    render(<HomeFinalCta locale="zh" />)

    expect(screen.getByText('你的专属行程')).toBeInTheDocument()
    expect(screen.queryByText(/巡礼点位/)).toBeNull()
  })

  it('背景复用第一屏横版插画；四片花瓣 aria-hidden、只在 lg 显示', () => {
    const { container } = render(<HomeFinalCta locale="zh" stats={statsFixture} />)

    const img = container.querySelector('img')!
    expect(img.getAttribute('src')).toBe('/images/home/hero-bg-landscape.webp')

    const petals = container.querySelectorAll('[data-final-cta-petal]')
    expect(petals).toHaveLength(4)
    const petalWrap = petals[0]!.parentElement!
    expect(petalWrap.getAttribute('aria-hidden')).toBe('true')
    expect(petalWrap.className).toContain('hidden')
    expect(petalWrap.className).toContain('lg:block')
  })
})
