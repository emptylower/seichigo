import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'

import HomeHeroDots, { HERO_DOTS_MAX } from '@/components/home/HomeHeroDots'
import type { HomeMapCell } from '@/lib/home/types'

function cells(n: number): HomeMapCell[] {
  return Array.from({ length: n }, (_, i) => ({ lng: 130 + (i % 100) * 0.1, lat: 33 + (i % 80) * 0.1, count: i + 1 }))
}

describe('HomeHeroDots（首屏点阵背景）', () => {
  it('每个格子一个 circle，数量与 cells 一致', () => {
    const { container } = render(<HomeHeroDots cells={cells(37)} bbox={[130, 33, 141, 45]} />)
    expect(container.querySelectorAll('circle')).toHaveLength(37)
  })

  it('格子过多时按 count 截到上限（首屏不塞几千个节点）', () => {
    const { container } = render(<HomeHeroDots cells={cells(HERO_DOTS_MAX + 120)} bbox={[130, 33, 141, 45]} />)
    expect(container.querySelectorAll('circle')).toHaveLength(HERO_DOTS_MAX)
  })

  it('viewBox 按 bbox 归一化，半径分 3 档、品牌粉低透明度', () => {
    const { container } = render(
      <HomeHeroDots
        cells={[
          { lng: 130, lat: 33, count: 1 },
          { lng: 135.5, lat: 39, count: 200 },
          { lng: 141, lat: 45, count: 5000 },
        ]}
        bbox={[130, 33, 141, 45]}
      />,
    )
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('viewBox')).toBe('0 0 100 100')
    expect(svg.getAttribute('aria-hidden')).toBe('true')

    const circles = [...container.querySelectorAll('circle')]
    expect(circles.map((c) => c.getAttribute('r'))).toEqual(['1', '1.6', '2.4'])
    // 左下角 → (0, 100)；右上角 → (100, 0)
    expect([circles[0]!.getAttribute('cx'), circles[0]!.getAttribute('cy')]).toEqual(['0', '100'])
    expect([circles[2]!.getAttribute('cx'), circles[2]!.getAttribute('cy')]).toEqual(['100', '0'])
    for (const circle of circles) {
      expect(circle.getAttribute('fill')).toBe('#ec4899')
      expect(Number(circle.getAttribute('opacity'))).toBeLessThanOrEqual(0.18)
      expect(Number(circle.getAttribute('opacity'))).toBeGreaterThanOrEqual(0.1)
    }
  })

  it('没有 cells 时不渲染（不加载地图库、也不留空 svg）', () => {
    const { container } = render(<HomeHeroDots cells={[]} />)
    expect(container.firstChild).toBeNull()
  })
})
