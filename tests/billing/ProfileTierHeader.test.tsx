import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

const useUsageMock = vi.fn()

vi.mock('@/hooks/useUsage', () => ({
  useUsage: () => useUsageMock(),
}))

vi.mock('next/image', () => ({
  default: ({ src, alt, fill: _fill, ...props }: any) => {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={alt} {...props} />
  },
}))

import { ProfileTierHeader } from '@/components/billing/ProfileTierHeader'

function usageOf(tier: 'free' | 'standard' | 'pro') {
  return { usage: { tier }, status: 'ready', refresh: () => {} }
}

describe('ProfileTierHeader', () => {
  beforeEach(() => {
    useUsageMock.mockReset()
  })

  it('standard：Avatar 带 S 徽标，品牌色 chip + 管理订阅链接锚点 #subscription', () => {
    useUsageMock.mockReturnValue(usageOf('standard'))
    render(<ProfileTierHeader locale="zh" name="Test User" email="t@example.com" image={null} />)
    expect(screen.getByText('Test User')).toBeInTheDocument()
    expect(screen.getByTestId('avatar-tier-badge')).toHaveTextContent('S')
    const chip = screen.getByTestId('profile-tier-chip')
    expect(chip).toHaveTextContent('标准')
    expect(chip.className).toContain('brand')
    const manage = screen.getByRole('link', { name: '管理订阅' })
    expect(manage).toHaveAttribute('href', '#subscription')
  })

  it('pro：金色 chip + P 徽标 + 管理订阅链接', () => {
    useUsageMock.mockReturnValue(usageOf('pro'))
    render(<ProfileTierHeader locale="zh" name="Test User" email={null} image={null} />)
    expect(screen.getByTestId('avatar-tier-badge')).toHaveTextContent('P')
    const chip = screen.getByTestId('profile-tier-chip')
    expect(chip).toHaveTextContent('高级')
    expect(chip.className).toContain('amber')
    expect(screen.getByRole('link', { name: '管理订阅' })).toHaveAttribute('href', '#subscription')
  })

  it('free：灰色 chip，无徽标、无管理订阅链接', () => {
    useUsageMock.mockReturnValue(usageOf('free'))
    render(<ProfileTierHeader locale="zh" name="Test User" email={null} image={null} />)
    expect(screen.queryByTestId('avatar-tier-badge')).toBeNull()
    const chip = screen.getByTestId('profile-tier-chip')
    expect(chip).toHaveTextContent('免费')
    expect(chip.className).toContain('slate')
    expect(screen.queryByRole('link', { name: '管理订阅' })).toBeNull()
  })

  it('usage 不可用：仍显示邮箱，但不显示 chip 与徽标', () => {
    useUsageMock.mockReturnValue({ usage: null, status: 'unavailable', refresh: () => {} })
    render(<ProfileTierHeader locale="zh" name={null} email="t@example.com" image={null} />)
    expect(screen.getByText('t@example.com')).toBeInTheDocument()
    expect(screen.queryByTestId('profile-tier-chip')).toBeNull()
    expect(screen.queryByTestId('avatar-tier-badge')).toBeNull()
  })

  it('en：chip 与管理链接是英文', () => {
    useUsageMock.mockReturnValue(usageOf('standard'))
    render(<ProfileTierHeader locale="en" name="Test User" email={null} image={null} />)
    expect(screen.getByTestId('profile-tier-chip')).toHaveTextContent('Standard')
    expect(screen.getByRole('link', { name: 'Manage subscription' })).toHaveAttribute('href', '#subscription')
  })

  it('ja：chip 与管理链接是日文', () => {
    useUsageMock.mockReturnValue(usageOf('pro'))
    render(<ProfileTierHeader locale="ja" name="Test User" email={null} image={null} />)
    expect(screen.getByTestId('profile-tier-chip')).toHaveTextContent('プロ')
    expect(screen.getByRole('link', { name: 'サブスクリプションを管理' })).toHaveAttribute('href', '#subscription')
  })
})
