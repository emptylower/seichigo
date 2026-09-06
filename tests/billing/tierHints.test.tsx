import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TierHint } from '@/components/billing/TierHint'

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
})
