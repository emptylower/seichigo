import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'

import HeroLaurel from '@/components/home/HeroLaurel'

describe('HeroLaurel', () => {
  it('是一枝纯装饰内联 SVG：一根主茎 + 6 片对生小叶，aria-hidden', () => {
    const { container } = render(<HeroLaurel className="text-gray-400" />)
    const svg = container.querySelector('svg')!

    expect(svg.getAttribute('aria-hidden')).toBe('true')
    expect(svg.getAttribute('viewBox')).toBe('0 0 22 26')
    expect(svg.getAttribute('class')).toContain('text-gray-400')
    expect(svg.querySelector('[data-laurel-stem]')).not.toBeNull()
    expect(svg.querySelectorAll('[data-laurel-leaf]')).toHaveLength(6)
    // 颜色跟随 currentColor，才能靠 className 调灰度
    expect(svg.querySelector('[data-laurel-stem]')!.getAttribute('stroke')).toBe('currentColor')
    expect(svg.querySelector('[data-laurel-leaf]')!.getAttribute('fill')).toBe('currentColor')
  })

  it('默认不镜像，mirrored 时整枝用 scale(-1, 1) 左右翻转', () => {
    const plain = render(<HeroLaurel />)
    expect(plain.container.querySelector('g')!.getAttribute('transform')).toBeNull()
    plain.unmount()

    const mirrored = render(<HeroLaurel mirrored />)
    const transform = mirrored.container.querySelector('g')!.getAttribute('transform') ?? ''
    expect(transform).toContain('scale(-1, 1)')
    expect(transform).toContain('translate(22, 0)')
  })
})
