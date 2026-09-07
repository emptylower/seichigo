import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import HomeGuides from '@/components/home/HomeGuides'
import { guidesFixture, postFixture } from './fixtures'
import type { PublicPostListItem } from '@/lib/posts/types'

function makeItem(overrides: Partial<PublicPostListItem>): PublicPostListItem {
  return { ...postFixture(1), ...overrides }
}

function cardLinks(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('a[href^="/posts/guide-"]')]
}

describe('HomeGuides（第四屏：左右两栏 + 3×2 攻略卡）', () => {
  it('最多渲染 6 篇，8 篇时裁掉多余的两篇', () => {
    const { container } = render(<HomeGuides locale="zh" items={guidesFixture(8)} />)

    const cards = cardLinks(container)
    expect(cards).toHaveLength(6)
    expect(cards.map((el) => el.getAttribute('href'))).toEqual(guidesFixture(6).map((item) => item.path))
    expect(screen.queryByRole('link', { name: /巡礼攻略 7/ })).toBeNull()
  })

  it('封面左上胶囊显示「作品 · 城市」，卡片带城市与日期，标题加粗', () => {
    render(<HomeGuides locale="zh" items={guidesFixture(1)} />)

    expect(screen.getByText('作品 1 · 东京')).toBeInTheDocument()
    expect(screen.getByText('东京')).toBeInTheDocument()
    expect(screen.getByText('2026-08-01')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '巡礼攻略 1' })).toBeInTheDocument()
  })

  it('无作品名（或 unknown）时胶囊只显示城市', () => {
    const { container } = render(<HomeGuides locale="zh" items={[makeItem({ localizedAnimeNames: ['unknown'] })]} />)

    const capsule = container.querySelector('.backdrop-blur')
    expect(capsule).not.toBeNull()
    expect(capsule!.textContent).toBe('东京')
    expect(screen.queryByText(/unknown/)).toBeNull()
  })

  it('作品名与城市都没有时不渲染胶囊', () => {
    const { container } = render(
      <HomeGuides locale="zh" items={[makeItem({ localizedAnimeNames: [], localizedCity: undefined, city: '' })]} />,
    )
    expect(container.querySelector('.backdrop-blur')).toBeNull()
  })

  it('publishDate 与 publishedAt 都没有时不显示日期', () => {
    render(<HomeGuides locale="zh" items={[makeItem({ publishDate: undefined, publishedAt: undefined })]} />)

    expect(screen.queryByText('2026-08-01')).toBeNull()
    expect(screen.queryByText(/\d{4}-\d{2}-\d{2}/)).toBeNull()
  })

  it('publishedAt（ISO 时间）兜底成 YYYY-MM-DD', () => {
    render(<HomeGuides locale="zh" items={[makeItem({ publishDate: undefined, publishedAt: '2026-03-02T08:00:00Z' })]} />)
    expect(screen.getByText('2026-03-02')).toBeInTheDocument()
  })

  it('大标题里的 {accent} 拆成粉色片段，前后文仍在', () => {
    render(<HomeGuides locale="zh" items={guidesFixture(1)} />)

    const accent = document.querySelector('[data-guides-accent]')!
    expect(accent.textContent).toBe('真实旅行者')
    expect(accent.className).toContain('text-brand-600')
    const heading = accent.closest('h2')!
    expect(heading.textContent).toContain('来自')
    expect(heading.textContent).toContain('动漫圣地巡礼攻略')
  })

  it('左栏四个卖点与「查看全部攻略」入口', () => {
    render(<HomeGuides locale="zh" items={guidesFixture(1)} />)

    for (const title of ['真实体验', '详细路线', '实拍照片', '实用建议']) {
      expect(screen.getByText(title)).toBeInTheDocument()
    }
    expect(screen.getByRole('link', { name: /全部攻略/ })).toHaveAttribute('href', '/posts')
  })

  it('没有任何「作者」「摘要」相关 DOM（PublicPostListItem 没有这些字段）', () => {
    const { container } = render(<HomeGuides locale="zh" items={guidesFixture(6)} />)
    expect(container.textContent).not.toContain('作者')
    expect(container.textContent).not.toContain('摘要')
  })

  it('没有攻略时整段不渲染', () => {
    const { container } = render(<HomeGuides locale="zh" items={[]} />)
    expect(container.firstChild).toBeNull()
  })
})
