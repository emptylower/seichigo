import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'

import HomeHeroRoute, { HERO_ROUTE_PATH, HERO_ROUTE_POINTS, HERO_ROUTE_VIEWBOX } from '@/components/home/HomeHeroRoute'

describe('HomeHeroRoute（贴在插画上的一笔画巡礼路线）', () => {
  it('与背景 <img> 同盒同裁切：viewBox 就是背景横版尺寸，slice 且对齐右中', () => {
    const { container } = render(<HomeHeroRoute />)
    const svg = container.querySelector('svg')!

    expect(HERO_ROUTE_VIEWBOX).toBe('0 0 1672 941')
    expect(svg.getAttribute('viewBox')).toBe(HERO_ROUTE_VIEWBOX)
    // 背景桌面用 object-position: right center，对应 SVG 的 xMaxYMid slice；
    // 用 xMid 会让路径整体左移、脱离画面里的海湾与城市
    expect(svg.getAttribute('preserveAspectRatio')).toBe('xMaxYMid slice')
  })

  it('固定路径：沿天际线往右到晴空塔脚下，4 个锚点即 4 个标记', () => {
    const { container } = render(<HomeHeroRoute />)

    expect(HERO_ROUTE_PATH).toBe('M 520 620 Q 790 584 1000 576 Q 1215 568 1350 600 Q 1430 619 1470 640')
    expect(HERO_ROUTE_POINTS).toEqual([
      [520, 620],
      [1000, 576],
      [1350, 600],
      [1470, 640],
    ])
    // 落在入口卡上沿之上：1440×900 时 y=640 换算到屏幕约 633px，卡片上沿约 700px
    for (const [, y] of HERO_ROUTE_POINTS) expect(y).toBeLessThan(700)

    const main = container.querySelector('path[pathLength="1"]')!
    const planned = container.querySelector('[data-hero-route-planned]')!
    expect(main.getAttribute('d')).toBe(HERO_ROUTE_PATH)
    expect(planned.getAttribute('d')).toBe(HERO_ROUTE_PATH)
    expect(planned.getAttribute('stroke-dasharray')).toBeTruthy()
  })

  it('4 个标记是白心粉边（r 9），最后一个额外带定位图钉', () => {
    const { container } = render(<HomeHeroRoute />)
    const dots = [...container.querySelectorAll('[data-hero-route-dot]')]

    expect(dots).toHaveLength(4)
    for (const dot of dots) {
      expect(dot.getAttribute('r')).toBe('9')
      expect(dot.getAttribute('fill')).toBe('#ffffff')
      expect(dot.getAttribute('stroke')).toBe('#ec4899')
    }
    expect(container.querySelectorAll('[data-hero-route-pin]')).toHaveLength(1)
  })

  it('画线 2.4s、标记依次弹出、光环脉动；reduced-motion 直接终态', () => {
    const { container } = render(<HomeHeroRoute />)
    const css = container.querySelector('style')!.textContent!

    expect(css).toContain('2.4s')
    expect(css).toContain('stroke-dashoffset')
    expect(css).toContain('@keyframes seichigo-hero-route-halo')
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*stroke-dashoffset: 0/)
    // 只用 transform / opacity / stroke-dashoffset 动
    expect(css).not.toContain('filter:')
    expect(css).not.toMatch(/animation:[^;]*\b(left|top|width|height)\b/)
  })

  it('只在 lg 以上出现，纯装饰不进无障碍树，SSR 与客户端同串', () => {
    const first = render(<HomeHeroRoute />)
    const root = first.container.querySelector('[data-hero-route]') as HTMLElement

    expect(root.className).toContain('hidden')
    expect(root.className).toContain('lg:block')
    expect(root.getAttribute('aria-hidden')).toBe('true')
    expect(root.className).toContain('pointer-events-none')

    const html = first.container.innerHTML
    first.unmount()
    expect(render(<HomeHeroRoute />).container.innerHTML).toBe(html)
  })
})
