import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import HomePageTemplate from '@/components/home/HomePageTemplate'
import type { HomePortalData } from '@/lib/home/types'

describe('home hero fallback', () => {
  it('renders CSS covers without issuing fallback image requests', () => {
    const data: HomePortalData = {
      featured: null,
      latestShelf: [],
      more: [],
      heroDisplay: [{ src: null }, { src: null }, { src: null }],
      starterSteps: [],
      popularAnime: [],
      popularCities: [],
    }

    const { container } = render(<HomePageTemplate locale="en" data={data} />)
    const covers = container.querySelectorAll('[data-home-hero-cover]')

    expect(covers).toHaveLength(3)
    expect([...covers].every((cover) => cover.querySelector('img') === null)).toBe(true)
    expect([...covers].every((cover) => cover.querySelector('[aria-hidden="true"]'))).toBe(true)
  })
})
