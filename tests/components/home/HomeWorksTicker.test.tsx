import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import HomeWorksTicker from '@/components/home/HomeWorksTicker'
import { heroWorkNames } from '@/components/home/heroData'
import { popularAnimeFixture } from './fixtures'
import { clearMatchMediaStub, setPrefersReducedMotion } from './reducedMotion'

describe('HomeWorksTicker（作品名滚动条）', () => {
  beforeEach(() => setPrefersReducedMotion(false))
  afterEach(() => clearMatchMediaStub())

  it('渲染作品名，滚动轨道复制一份保证无缝', () => {
    render(<HomeWorksTicker names={['你的名字。', '孤独摇滚', '轻音少女']} label="已收录的作品" />)

    expect(screen.getAllByText('你的名字。').length).toBeGreaterThanOrEqual(1)
    const tracks = document.querySelectorAll('[data-ticker-track]')
    expect(tracks).toHaveLength(2)
    expect(tracks[1]!.getAttribute('aria-hidden')).toBe('true')
  })

  it('prefers-reduced-motion 下静态排列（不复制、不加动画）', () => {
    setPrefersReducedMotion(true)
    render(<HomeWorksTicker names={['你的名字。', '孤独摇滚']} label="已收录的作品" />)

    expect(document.querySelectorAll('[data-ticker-track]')).toHaveLength(1)
    expect(document.querySelector('[data-ticker-track]')?.getAttribute('data-animated')).toBe('false')
  })

  it('没有作品名时整段不渲染', () => {
    const { container } = render(<HomeWorksTicker names={[]} label="已收录的作品" />)
    expect(container.firstChild).toBeNull()
  })
})

describe('heroWorkNames（按 locale 取作品显示名）', () => {
  it('不足 8 个时重复一轮补齐（CSS 无限滚动不留空）', () => {
    expect(heroWorkNames(popularAnimeFixture(3), 'zh')).toEqual([
      '作品 1', '作品 2', '作品 3', '作品 1', '作品 2', '作品 3', '作品 1', '作品 2',
    ])
  })

  it('ja 取日文原名、en 取英文名（与作品卡同一套显示名逻辑）', () => {
    expect(heroWorkNames(popularAnimeFixture(3), 'ja').slice(0, 3)).toEqual([
      '作品1（日）', '作品2（日）', '作品3（日）',
    ])
    expect(heroWorkNames(popularAnimeFixture(3), 'en').slice(0, 3)).toEqual(['Work 1', 'Work 2', 'Work 3'])
  })

  it('缺译名时回退中文名，不会漏成空串', () => {
    const items = [
      { anime: { id: 'a1', name: '孤独摇滚' }, postCount: 2, cover: null },
      { anime: { id: 'a2', name: '你的名字。', name_ja: '君の名は。' }, postCount: 1, cover: null },
    ]
    expect(heroWorkNames(items, 'ja').slice(0, 2)).toEqual(['孤独摇滚', '君の名は。'])
    expect(heroWorkNames(items, 'en').slice(0, 2)).toEqual(['孤独摇滚', '你的名字。'])
  })

  it('够 8 个时原样返回', () => {
    expect(heroWorkNames(popularAnimeFixture(9), 'zh')).toHaveLength(9)
  })

  it('没有作品时返回空数组', () => {
    expect(heroWorkNames([], 'zh')).toEqual([])
  })
})
