import React from 'react'
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { mdxComponents } from '@/lib/mdx/mdxComponents'

describe('mdx img component', () => {
  it('rewrites internal /assets images for progressive loading', () => {
    const Img = (mdxComponents as any).img as React.FC<any>
    const { container } = render(<Img src="/assets/abc123" alt="x" />)
    const el = container.querySelector('img') as HTMLImageElement
    expect(el.getAttribute('data-seichi-full')).toBe('/assets/abc123')
    expect(el.getAttribute('data-seichi-sd')).toBe('/assets/abc123?w=854&q=70')
    expect(el.getAttribute('data-seichi-hd')).toBe('/assets/abc123?w=1280&q=80')
    expect(el.getAttribute('src')).toBe('/assets/abc123?w=32&q=20')
    expect(el.getAttribute('data-seichi-blur')).toBe('true')
  })

  it('keeps external images unchanged', () => {
    const Img = (mdxComponents as any).img as React.FC<any>
    const { container } = render(<Img src="https://example.com/a.jpg" alt="x" />)
    const el = container.querySelector('img') as HTMLImageElement
    expect(el.getAttribute('src')).toBe('https://example.com/a.jpg')
    expect(el.getAttribute('data-seichi-full')).toBeNull()
  })
})

