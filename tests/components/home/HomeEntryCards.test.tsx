import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import HomeEntryCards from '@/components/home/HomeEntryCards'
import { statsFixture } from './fixtures'

describe('HomeEntryCards', () => {
  it('三张入口卡指向规划师 / 地图 / 攻略（/plan 不加语言前缀）', () => {
    render(<HomeEntryCards locale="en" stats={statsFixture} />)

    // 起始页是三语本地化路由：AI 规划卡直接指向目标语言路径（不带 query）
    expect(screen.getByRole('link', { name: /AI Planner/ })).toHaveAttribute('href', '/en/plan/start')
    expect(screen.getByRole('link', { name: /Pilgrimage Map/ })).toHaveAttribute('href', '/en/map')
    expect(screen.getByRole('link', { name: /Pilgrimage Guides/ })).toHaveAttribute('href', '/en/posts')
    // 次级入口：/pricing 现在三语都有镜像页，走 prefixPath
    expect(screen.getByRole('link', { name: 'See pricing' })).toHaveAttribute('href', '/en/pricing')
  })

  it('用 Intl.NumberFormat(locale) 展示真实计数', () => {
    render(<HomeEntryCards locale="en" stats={statsFixture} />)

    expect(screen.getByText('128,456 pilgrimage spots')).toBeInTheDocument()
    expect(screen.getByText('1,234 anime series')).toBeInTheDocument()
    expect(screen.getByText('96 cities')).toBeInTheDocument()
    expect(screen.getByText('87 guides')).toBeInTheDocument()
  })

  it('第十四轮：卡片是压在插画上的半透明毛玻璃（hover 更实）', () => {
    render(<HomeEntryCards locale="zh" stats={statsFixture} />)

    // 只看卡片本身（卡片下方还有一条指向 /pricing 的次级文字链）
    const links = [...document.querySelectorAll('.grid a')]
    expect(links).toHaveLength(3)
    for (const link of links) {
      expect(link.className).toContain('bg-white/75')
      expect(link.className).toContain('backdrop-blur-sm')
      expect(link.className).toContain('border-white/60')
      expect(link.className).toContain('hover:bg-white/90')
    }
  })

  it('缺 stats（A 部分尚未落盘）时只隐藏数字，不影响入口', () => {
    render(<HomeEntryCards locale="zh" />)

    expect(screen.getByRole('link', { name: /AI 规划/ })).toHaveAttribute('href', '/plan/start')
    expect(screen.queryByText(/个巡礼点位/)).toBeNull()
  })
})
