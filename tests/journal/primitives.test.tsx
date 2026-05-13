import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { PaperCard } from '@/app/(authed)/me/journal/primitives/PaperCard'
import { RedSeal } from '@/app/(authed)/me/journal/primitives/RedSeal'
import { WashiTape } from '@/app/(authed)/me/journal/primitives/WashiTape'
import { InkDivider } from '@/app/(authed)/me/journal/primitives/InkDivider'
import { StitchedBorder } from '@/app/(authed)/me/journal/primitives/StitchedBorder'
import { PageFoldCorner } from '@/app/(authed)/me/journal/primitives/PageFoldCorner'

describe('journal primitives', () => {
  it('PaperCard renders children', () => {
    const { getByText } = render(<PaperCard>hello</PaperCard>)
    expect(getByText('hello')).toBeTruthy()
  })

  it('RedSeal supports square (default) and round variants', () => {
    const { getByTestId, rerender } = render(<RedSeal>巡礼者</RedSeal>)
    expect(getByTestId('red-seal').dataset.variant).toBe('square')
    rerender(<RedSeal variant="round">巡</RedSeal>)
    expect(getByTestId('red-seal').dataset.variant).toBe('round')
  })

  it('WashiTape renders as an empty absolute strip', () => {
    const { getByTestId } = render(<WashiTape color="rose" />)
    expect(getByTestId('washi-tape').className).toMatch(/absolute/)
  })

  it('InkDivider is a 1px gradient bar', () => {
    const { getByTestId } = render(<InkDivider />)
    expect(getByTestId('ink-divider').className).toMatch(/h-px/)
  })

  it('StitchedBorder wraps children with dashed border', () => {
    const { getByText, getByTestId } = render(<StitchedBorder>x</StitchedBorder>)
    expect(getByText('x')).toBeTruthy()
    expect(getByTestId('stitched-border').className).toMatch(/border-dashed/)
  })

  it('PageFoldCorner renders an aria-hidden corner', () => {
    const { getByTestId } = render(<PageFoldCorner />)
    expect(getByTestId('page-fold').getAttribute('aria-hidden')).toBe('true')
  })
})
