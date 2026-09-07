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
  it('en：四条提示都是英文，链接带 /en 前缀', () => {
    const { container } = render(
      <>
        <TierHint kind="transit" locale="en" />
        <TierHint kind="restaurant" locale="en" />
        <TierHint kind="map" locale="en" />
        <TierHint kind="days" locale="en" />
      </>,
    )
    expect(screen.getByText('Upgrade to see real routes and travel times')).toBeInTheDocument()
    expect(screen.getByText('Upgrade to get restaurant picks')).toBeInTheDocument()
    expect(screen.getByText('Upgrade to show real routes')).toBeInTheDocument()
    expect(screen.getByText('Upgrade to plan more days')).toBeInTheDocument()
    for (const link of screen.getAllByRole('link')) expect(link).toHaveAttribute('href', '/en/pricing')
    expect(/[一-龥ぁ-ヿ]/.test(container.textContent ?? '')).toBe(false)
  })
  it('ja：提示是日文，链接带 /ja 前缀', () => {
    render(<TierHint kind="transit" locale="ja" />)
    expect(screen.getByText('アップグレードすると実際のルートと所要時間を表示します')).toBeInTheDocument()
    expect(screen.getByRole('link')).toHaveAttribute('href', '/ja/pricing')
  })
})

describe('DaysLimitHint', () => {
  it('shows the hint once the plan reaches the tier day cap', () => {
    render(<DaysLimitHint dayCount={3} maxDays={3} />)
    expect(screen.getByText(/升级可规划更多天数/)).toBeInTheDocument()
  })
  it('把 locale 透传给 TierHint（en / ja）', () => {
    render(<DaysLimitHint dayCount={3} maxDays={3} locale="en" />)
    expect(screen.getByText('Upgrade to plan more days')).toBeInTheDocument()
    render(<DaysLimitHint dayCount={3} maxDays={3} locale="ja" />)
    expect(screen.getByText('アップグレードするともっと長い日程を組めます')).toBeInTheDocument()
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
