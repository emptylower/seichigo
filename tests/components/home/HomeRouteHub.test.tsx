import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import HomeRouteHub from '@/components/home/HomeRouteHub'

describe('HomeRouteHub', () => {
  it('renders map-first module and locale-aware links', () => {
    render(<HomeRouteHub locale="en" />)

    expect(screen.getByRole('heading', { name: 'Route Planning Hub' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Open Map Workspace →/ })).toHaveAttribute('href', '/en/map')
    expect(screen.getByRole('link', { name: /Open Anime Index →/ })).toHaveAttribute('href', '/en/anime')
    expect(screen.getByRole('link', { name: /Open City Hubs →/ })).toHaveAttribute('href', '/en/city')
    expect(screen.getByRole('link', { name: /Open Resources →/ })).toHaveAttribute('href', '/en/resources')
  })

  it('prioritizes the above-the-fold map background', () => {
    const { container } = render(<HomeRouteHub locale="en" />)
    const background = container.querySelector('img[src="/images/home/chopper-map-base.webp"]')

    expect(background).toHaveAttribute('loading', 'eager')
    expect(background).toHaveAttribute('fetchpriority', 'high')
  })
})
