import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import HomeBrowse from '@/components/home/HomeBrowse'
import { popularAnimeFixture, popularCitiesFixture } from './fixtures'
import type { HomePopularAnimeItem, HomePopularCityItem } from '@/lib/home/types'

describe('HomeBrowse（第五屏：热门作品 & 热门城市）', () => {
  it('居中标题：eyebrow、「&」是品牌色片段、副标题', () => {
    render(<HomeBrowse locale="zh" anime={popularAnimeFixture(2)} cities={popularCitiesFixture(2)} />)

    expect(screen.getByText('发现更多创作与旅行灵感')).toBeInTheDocument()
    const amp = document.querySelector('[data-browse-amp]')!
    expect(amp.textContent).toBe('&')
    expect(amp.className).toContain('text-brand-600')
    const heading = amp.closest('h2')!
    expect(heading.textContent).toContain('热门作品')
    expect(heading.textContent).toContain('热门城市')
  })

  it('作品最多 8 个、城市最多 12 个，链接规则与列表页卡片一致', () => {
    const { container } = render(<HomeBrowse locale="zh" anime={popularAnimeFixture(10)} cities={popularCitiesFixture(15)} />)

    const animeLinks = [...container.querySelectorAll('a[href^="/anime/"]')]
    const cityLinks = [...container.querySelectorAll('a[href^="/city/"]')]
    expect(animeLinks).toHaveLength(8)
    expect(cityLinks).toHaveLength(12)
    expect(animeLinks[0]!.getAttribute('href')).toBe('/anime/anime-1')
    expect(cityLinks[0]!.getAttribute('href')).toBe('/city/city-1')
  })

  it('「攻略 n 篇」胶囊的数字来自真实 postCount', () => {
    render(<HomeBrowse locale="zh" anime={popularAnimeFixture(2)} cities={popularCitiesFixture(1)} />)

    // popularAnimeFixture：postCount 3、4；popularCitiesFixture：postCount 2
    expect(screen.getByText('攻略 3 篇')).toBeInTheDocument()
    expect(screen.getByText('攻略 4 篇')).toBeInTheDocument()
    expect(screen.getByText('攻略 2 篇')).toBeInTheDocument()
  })

  it('postCount 为 0 的条目不渲染胶囊（不显示「0 篇」）', () => {
    const anime: HomePopularAnimeItem[] = [{ anime: { id: 'a0', name: '零篇作品' }, postCount: 0, cover: null }]
    const cities: HomePopularCityItem[] = [{ ...popularCitiesFixture(1)[0]!, postCount: 0 }]
    const { container } = render(<HomeBrowse locale="zh" anime={anime} cities={cities} />)

    expect(container.textContent).not.toContain('0 篇')
    expect(container.querySelectorAll('.bg-brand-50.rounded-full')).toHaveLength(0)
  })

  it('无封面时用浅粉渐变占位：城市卡居中显示名字首字', () => {
    render(<HomeBrowse locale="zh" anime={popularAnimeFixture(1)} cities={popularCitiesFixture(1)} />)

    // fixture 的 cover 都是 null → 没有 <img>
    expect(document.querySelectorAll('section img')).toHaveLength(0)
    // 城市名「城市 1」的首字占位
    expect(screen.getByText('城')).toBeInTheDocument()
  })

  it('有封面时渲染 <img>', () => {
    const anime: HomePopularAnimeItem[] = [{ anime: { id: 'a1', name: '有封面' }, postCount: 1, cover: '/assets/a1.jpg' }]
    render(<HomeBrowse locale="zh" anime={anime} cities={[]} />)

    const img = document.querySelector('img')!
    expect(img.getAttribute('src')).toBe('/assets/a1.jpg')
    expect(img.getAttribute('alt')).toBe('有封面')
  })

  it('栏目标题与「全部作品 / 全部城市」入口', () => {
    render(<HomeBrowse locale="zh" anime={popularAnimeFixture(1)} cities={popularCitiesFixture(1)} />)

    expect(screen.getByRole('link', { name: /全部作品/ })).toHaveAttribute('href', '/anime')
    expect(screen.getByRole('link', { name: /全部城市/ })).toHaveAttribute('href', '/city')
  })

  it('两列都为空时整段不渲染', () => {
    const { container } = render(<HomeBrowse locale="zh" anime={[]} cities={[]} />)
    expect(container.firstChild).toBeNull()
  })
})
