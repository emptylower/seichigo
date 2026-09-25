import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import HomeEntryCards from '@/components/home/HomeEntryCards'

describe('HomeEntryCards', () => {
  it('两张入口卡指向地图与攻略（带语言前缀，AI 规划不再单列）', () => {
    render(<HomeEntryCards locale="en" />)

    expect(screen.getByRole('link', { name: /Pilgrimage Map/ })).toHaveAttribute('href', '/en/map')
    expect(screen.getByRole('link', { name: /Pilgrimage Guides/ })).toHaveAttribute('href', '/en/posts')
    // 首屏主输入框就是规划入口，AI 规划卡与 /pricing 文字链都不再在首屏出现
    expect(screen.queryByRole('link', { name: /AI Planner/ })).toBeNull()
    expect(screen.queryByRole('link', { name: 'See pricing' })).toBeNull()
  })

  it('标题节点是 span.font-semibold，与公共导航名称逐字一致', () => {
    const { container } = render(<HomeEntryCards locale="zh" />)

    const cards = [...container.querySelectorAll('.grid a')]
    expect(cards).toHaveLength(2)
    const titles = cards.map((a) => a.querySelector('span.font-semibold')?.textContent)
    expect(titles).toEqual(['巡礼地图', '巡礼攻略'])
  })

  it('第十六轮：两张压在插画上的半透明毛玻璃大卡（hover 变实）', () => {
    const { container } = render(<HomeEntryCards locale="zh" />)

    const links = [...container.querySelectorAll('.grid a')]
    expect(links).toHaveLength(2)
    for (const link of links) {
      expect(link.className).toContain('bg-white/80')
      expect(link.className).toContain('backdrop-blur-sm')
      expect(link.className).toContain('border-white/60')
      expect(link.className).toContain('hover:border-brand-300')
      expect(link.className).toContain('hover:bg-white/95')
      expect(link.className).toContain('overflow-hidden')
      expect(link.className).toContain('no-underline')
    }
  })

  it('右侧装饰图 aria-hidden + 空 alt + 懒加载；地图卡多一个 ArrowRight 圆按钮', () => {
    const { container } = render(<HomeEntryCards locale="zh" />)

    const images = [...container.querySelectorAll('img')]
    expect(images.map((img) => img.getAttribute('src'))).toEqual([
      '/images/home/map-world.webp',
      '/images/home/entry-guides.jpg',
    ])
    for (const img of images) {
      expect(img.getAttribute('aria-hidden')).toBe('true')
      expect(img.getAttribute('alt')).toBe('')
      expect(img.getAttribute('loading')).toBe('lazy')
    }

    // 只有地图卡带白色圆形 ArrowRight 按钮（aria-hidden，纯装饰）
    const mapCard = screen.getByRole('link', { name: /巡礼地图/ })
    const guidesCard = screen.getByRole('link', { name: /巡礼攻略/ })
    expect(mapCard.querySelector('svg.lucide-arrow-right')).not.toBeNull()
    expect(guidesCard.querySelector('svg.lucide-arrow-right')).toBeNull()
  })

  it('en/ja 长描述可折行不被装饰图压住（文字区给右侧装饰留 padding-right）', () => {
    render(<HomeEntryCards locale="en" />)

    const mapDesc = screen.getByText('Find every filming spot on a worldwide map')
    const guidesDesc = screen.getByText('Read a route someone already walked')
    expect(mapDesc.className).toContain('text-xs')
    expect(guidesDesc.className).toContain('text-xs')
    // 文字容器带右 padding，让位给右侧装饰（地图卡的圆按钮 / 攻略卡的缩略图条）
    const mapTextBox = screen.getByText('Pilgrimage Map').parentElement!
    const guidesTextBox = screen.getByText('Pilgrimage Guides').parentElement!
    expect(mapTextBox.className).toContain('pr-14')
    expect(guidesTextBox.className).toContain('pr-[126px]')
  })
})
