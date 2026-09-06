import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { UsageMeter } from '@/components/billing/UsageMeter'

const view = {
  tier: 'free' as const,
  // 接口仍返回中文 tierLabel（兼容），组件不再读它：三语档位名从字典取
  tierLabel: '免费',
  remainingPercent: 42,
  resetsAt: '2026-09-20T00:00:00.000Z',
  upgradeAvailable: true,
  hints: { transitEstimateOnly: true, restaurantsLocked: true, maxDays: 3 },
}

describe('UsageMeter', () => {
  it('renders percent, reset date, tier label and an upgrade link for free users', () => {
    render(<UsageMeter usage={view} size="full" />)
    expect(screen.getByText(/本月 agent 用量剩余 42%/)).toBeInTheDocument()
    expect(screen.getByText(/日恢复/)).toBeInTheDocument()
    expect(screen.getByText('免费')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /升级/ })).toHaveAttribute('href', '/pricing')
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '42')
  })
  it('en：文案与档位名全英文，升级入口带 /en 前缀', () => {
    const { container } = render(<UsageMeter usage={view} size="full" locale="en" />)
    expect(screen.getByText('Agent usage left this month: 42%')).toBeInTheDocument()
    expect(screen.getByText(/^Resets on /)).toBeInTheDocument()
    expect(screen.getByText('Free')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Upgrade/ })).toHaveAttribute('href', '/en/pricing')
    expect(/[一-龥ぁ-ヿ]/.test(container.textContent ?? '')).toBe(false)
  })
  it('ja：文案与档位名是日文，升级入口带 /ja 前缀', () => {
    render(<UsageMeter usage={{ ...view, tier: 'standard' }} size="compact" locale="ja" />)
    expect(screen.getByText('今月のエージェント残量 42%')).toBeInTheDocument()
    expect(screen.getByText(/に回復します$/)).toBeInTheDocument()
    expect(screen.getByText('スタンダード')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /アップグレード/ })).toHaveAttribute('href', '/ja/pricing')
  })
  it('档位名不再来自接口的 tierLabel', () => {
    render(<UsageMeter usage={{ ...view, tier: 'pro', tierLabel: '接口给的中文' }} size="full" locale="en" />)
    expect(screen.queryByText('接口给的中文')).toBeNull()
    expect(screen.getByText('Pro')).toBeInTheDocument()
  })
  it('hides the upgrade link when not available', () => {
    render(<UsageMeter usage={{ ...view, tier: 'standard', upgradeAvailable: false }} size="compact" />)
    expect(screen.queryByRole('link', { name: /升级/ })).toBeNull()
  })
  it('renders nothing without usage', () => {
    const { container } = render(<UsageMeter usage={null} size="compact" />)
    expect(container).toBeEmptyDOMElement()
  })
  it('G10：nearlyEmpty 时取整百分比为 0 也显示 "<1%"', () => {
    render(<UsageMeter usage={{ ...view, remainingPercent: 0, nearlyEmpty: true }} size="compact" />)
    expect(screen.getByText(/<1%/)).toBeInTheDocument()
  })
})
