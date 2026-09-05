import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'

import HomeHeroBackground from '@/components/home/HomeHeroBackground'

function srcSetOf(el: Element): string | null {
  return el.getAttribute('srcset') ?? el.getAttribute('srcSet')
}

describe('HomeHeroBackground（首屏插画背景）', () => {
  it('<picture> 两组 source：lg 以上横版、以下竖版，各 avif + webp（avif 排在 webp 前）', () => {
    const { container } = render(<HomeHeroBackground />)
    const sources = [...container.querySelectorAll('source')]

    expect(sources.map((s) => [s.getAttribute('media'), s.getAttribute('type'), srcSetOf(s)])).toEqual([
      ['(min-width: 1024px)', 'image/avif', '/images/home/hero-bg-landscape.avif'],
      ['(min-width: 1024px)', 'image/webp', '/images/home/hero-bg-landscape.webp'],
      [null, 'image/avif', '/images/home/hero-bg-portrait.avif'],
      [null, 'image/webp', '/images/home/hero-bg-portrait.webp'],
    ])
  })

  it('<img> 是首屏 LCP 候选：eager + fetchpriority=high + decoding=async，装饰性 alt 为空', () => {
    const { container } = render(<HomeHeroBackground />)
    const img = container.querySelector('img')!

    expect(img.getAttribute('src')).toBe('/images/home/hero-bg-portrait.webp')
    expect(img.getAttribute('alt')).toBe('')
    expect(img.getAttribute('loading')).toBe('eager')
    expect(img.getAttribute('fetchpriority')).toBe('high')
    expect(img.getAttribute('decoding')).toBe('async')
    // 移动端 center bottom（樱花与城市在下半张），桌面 right center（富士山 + 晴空塔在右）
    expect(img.className).toContain('object-cover')
    expect(img.className).toContain('object-bottom')
    expect(img.className).toContain('lg:object-right')
  })

  it('叠三层渐变：桌面左侧白、页眉下的顶部白、接第二屏的底部白', () => {
    const { container } = render(<HomeHeroBackground />)
    const layers = [...container.querySelectorAll('[data-hero-gradient]')].map((el) =>
      el.getAttribute('data-hero-gradient'),
    )

    expect(layers).toEqual(['side', 'top', 'bottom'])
  })

  it('reduced-motion 与移动端渐变都走组件内 <style> 的 media query（不读 window）', () => {
    const { container } = render(<HomeHeroBackground />)
    const css = container.querySelector('style')!.textContent!

    expect(css).toContain('@media (prefers-reduced-motion: reduce)')
    expect(css).toContain('@media (min-width: 1024px)')
    expect(container.innerHTML).not.toContain('matchMedia')
  })

  it('樱花花瓣 6 片，只在 lg 以上显示，只用 transform 动', () => {
    const { container } = render(<HomeHeroBackground />)
    const petals = [...container.querySelectorAll('[data-hero-petal]')]
    const css = container.querySelector('style')!.textContent!

    expect(petals).toHaveLength(6)
    const petalBox = container.querySelector('[data-hero-petals]') as HTMLElement
    expect(petalBox.className).toContain('hidden')
    expect(petalBox.className).toContain('lg:block')
    expect(css).toMatch(/@keyframes seichigo-hero-petal-\d/)
    expect(css).not.toContain('filter:')
  })

  it('纯装饰层：aria-hidden + pointer-events-none，且两次渲染完全一致（SSR 与客户端同串）', () => {
    const first = render(<HomeHeroBackground />)
    const root = first.container.querySelector('[data-testid="hero-background"]')!
    expect(root.getAttribute('aria-hidden')).toBe('true')
    expect(root.className).toContain('pointer-events-none')

    const html = first.container.innerHTML
    first.unmount()
    const second = render(<HomeHeroBackground />)
    expect(second.container.innerHTML).toBe(html)
  })
})
