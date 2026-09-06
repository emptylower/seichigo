import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import HomeGuides from '@/components/home/HomeGuides'
import { guidesFixture } from './fixtures'

function cardsOf(container: HTMLElement) {
  return [...container.querySelectorAll<HTMLElement>('a[href^="/posts/guide-"]')]
}

describe('HomeGuides', () => {
  it('渲染 8 张攻略卡与「全部攻略」入口', () => {
    render(<HomeGuides locale="zh" items={guidesFixture(8)} />)

    expect(screen.getByRole('heading', { name: '巡礼攻略' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '全部攻略' })).toHaveAttribute('href', '/posts')
    for (let i = 1; i <= 8; i++) {
      expect(screen.getByRole('link', { name: new RegExp(`巡礼攻略 ${i}`) })).toHaveAttribute('href', `/posts/guide-${i}`)
    }
  })

  it('卡片带作品名、城市与路线长度', () => {
    render(<HomeGuides locale="zh" items={guidesFixture(1)} />)

    expect(screen.getByText(/作品 1/)).toBeInTheDocument()
    expect(screen.getByText(/东京/)).toBeInTheDocument()
    expect(screen.getByText(/3 天/)).toBeInTheDocument()
  })

  it('8 篇时 2 大 6 小，顺序与输入一致', () => {
    const items = guidesFixture(8)
    const { container } = render(<HomeGuides locale="zh" items={items} />)

    const cards = cardsOf(container)
    expect(cards.map((el) => el.getAttribute('href'))).toEqual(items.map((item) => item.path))
    expect(cards.map((el) => el.dataset.guideSize)).toEqual([
      'large',
      'large',
      'small',
      'small',
      'small',
      'small',
      'small',
      'small',
    ])
  })

  it('5 篇时 2 大 3 小，不留空位', () => {
    const items = guidesFixture(5)
    const { container } = render(<HomeGuides locale="zh" items={items} />)

    const cards = cardsOf(container)
    expect(cards.map((el) => el.getAttribute('href'))).toEqual(items.map((item) => item.path))
    expect(cards.filter((el) => el.dataset.guideSize === 'large')).toHaveLength(2)
    expect(cards.filter((el) => el.dataset.guideSize === 'small')).toHaveLength(3)
  })

  it('只有一篇时 1 大 0 小', () => {
    const { container } = render(<HomeGuides locale="zh" items={guidesFixture(1)} />)

    const cards = cardsOf(container)
    expect(cards).toHaveLength(1)
    expect(cards[0]!.dataset.guideSize).toBe('large')
  })

  it('大卡区两列、小卡区三列，移动端单列', () => {
    const { container } = render(<HomeGuides locale="zh" items={guidesFixture(8)} />)

    const large = cardsOf(container).find((el) => el.dataset.guideSize === 'large')!
    const small = cardsOf(container).find((el) => el.dataset.guideSize === 'small')!
    expect(large.parentElement?.className).toContain('grid-cols-1')
    expect(large.parentElement?.className).toContain('md:grid-cols-2')
    expect(small.parentElement?.className).toContain('grid-cols-1')
    expect(small.parentElement?.className).toContain('md:grid-cols-3')
  })

  it('大卡封面 eager、小卡 lazy，封面统一 16:9', () => {
    const { container } = render(<HomeGuides locale="zh" items={guidesFixture(8)} />)

    const cards = cardsOf(container)
    for (const card of cards) {
      const img = card.querySelector('img')!
      expect(img.getAttribute('loading')).toBe(card.dataset.guideSize === 'large' ? 'eager' : 'lazy')
      expect(img.parentElement?.className).toContain('aspect-[16/9]')
    }
  })

  it('没有攻略时整段不渲染', () => {
    const { container } = render(<HomeGuides locale="zh" items={[]} />)
    expect(container.firstChild).toBeNull()
  })
})
