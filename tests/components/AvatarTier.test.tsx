import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('next/image', () => ({
  default: ({ src, alt, fill: _fill, ...props }: any) => {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={alt} {...props} />
  },
}))

import Avatar from '@/components/shared/Avatar'

describe('Avatar 套餐档位环与徽标', () => {
  it('未传 tier：无环无徽标（现状不变）', () => {
    render(<Avatar name="Test User" />)
    expect(screen.queryByTestId('avatar-tier-ring')).toBeNull()
    expect(screen.queryByTestId('avatar-tier-badge')).toBeNull()
  })

  it('tier=free：无环无徽标', () => {
    render(<Avatar name="Test User" tier="free" />)
    expect(screen.queryByTestId('avatar-tier-ring')).toBeNull()
    expect(screen.queryByTestId('avatar-tier-badge')).toBeNull()
  })

  it('tier=standard：品牌色渐变环 + S 徽标，title 为档位名', () => {
    render(<Avatar name="Test User" tier="standard" tierLabel="标准" />)
    const ring = screen.getByTestId('avatar-tier-ring')
    expect(ring.className).toContain('from-brand-400')
    expect(ring.className).toContain('to-pink-400')
    const badge = screen.getByTestId('avatar-tier-badge')
    expect(badge).toHaveTextContent('S')
    expect(badge).toHaveAttribute('title', '标准')
  })

  it('tier=pro：金色渐变环 + P 徽标', () => {
    render(<Avatar name="Test User" tier="pro" tierLabel="高级" />)
    const ring = screen.getByTestId('avatar-tier-ring')
    expect(ring.className).toContain('from-amber-400')
    expect(ring.className).toContain('to-yellow-300')
    const badge = screen.getByTestId('avatar-tier-badge')
    expect(badge).toHaveTextContent('P')
    expect(badge).toHaveAttribute('title', '高级')
  })

  it('环与徽标不改变外层布局尺寸', () => {
    const { container } = render(<Avatar name="Test User" size={32} tier="standard" />)
    expect(container.firstChild).toHaveStyle('width: 32px; height: 32px')
  })
})
