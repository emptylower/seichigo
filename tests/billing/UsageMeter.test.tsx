import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { UsageMeter } from '@/components/billing/UsageMeter'

const view = {
  tier: 'free' as const,
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
  it('hides the upgrade link when not available', () => {
    render(<UsageMeter usage={{ ...view, tier: 'standard', tierLabel: '标准', upgradeAvailable: false }} size="compact" />)
    expect(screen.queryByRole('link', { name: /升级/ })).toBeNull()
  })
  it('renders nothing without usage', () => {
    const { container } = render(<UsageMeter usage={null} size="compact" />)
    expect(container).toBeEmptyDOMElement()
  })
})
