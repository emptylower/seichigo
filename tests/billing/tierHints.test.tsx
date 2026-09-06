import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TierHint } from '@/components/billing/TierHint'
import { DaysLimitHint } from '@/components/billing/DaysLimitHint'

describe('TierHint', () => {
  it('renders the transit hint with a pricing link', () => {
    render(<TierHint kind="transit" />)
    expect(screen.getByText(/升级后可查看真实路线/)).toBeInTheDocument()
    expect(screen.getByRole('link')).toHaveAttribute('href', '/pricing')
  })
  it('renders the restaurant placeholder', () => {
    render(<TierHint kind="restaurant" />)
    expect(screen.getByText(/升级后可推荐餐厅/)).toBeInTheDocument()
  })
  it('renders the map hint with a pricing link', () => {
    render(<TierHint kind="map" />)
    expect(screen.getByText(/升级后显示真实路线/)).toBeInTheDocument()
    expect(screen.getByRole('link')).toHaveAttribute('href', '/pricing')
  })
  it('renders the days hint with a pricing link', () => {
    render(<TierHint kind="days" />)
    expect(screen.getByText(/升级可规划更多天数/)).toBeInTheDocument()
    expect(screen.getByRole('link')).toHaveAttribute('href', '/pricing')
  })
})

describe('DaysLimitHint', () => {
  it('shows the hint once the plan reaches the tier day cap', () => {
    render(<DaysLimitHint dayCount={3} maxDays={3} />)
    expect(screen.getByText(/升级可规划更多天数/)).toBeInTheDocument()
  })
  it('stays hidden below the cap, without hints, and when the cap means unlimited', () => {
    const { container: below } = render(<DaysLimitHint dayCount={2} maxDays={3} />)
    expect(below).toBeEmptyDOMElement()
    const { container: missing } = render(<DaysLimitHint dayCount={9} maxDays={null} />)
    expect(missing).toBeEmptyDOMElement()
    const { container: unlimited } = render(<DaysLimitHint dayCount={99} maxDays={30} />)
    expect(unlimited).toBeEmptyDOMElement()
  })
})
