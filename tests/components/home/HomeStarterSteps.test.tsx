import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import HomeStarterSteps from '@/components/home/HomeStarterSteps'
import type { HomeStarterItem } from '@/lib/home/types'

const steps: HomeStarterItem[] = [
  {
    id: 'anime',
    href: '/anime',
    titleKey: 'pages.home.starterStep1Title',
    descKey: 'pages.home.starterStep1Desc',
    ctaKey: 'pages.home.viewAllAnimeLinkAlt',
  },
  {
    id: 'city',
    href: '/city',
    titleKey: 'pages.home.starterStep2Title',
    descKey: 'pages.home.starterStep2Desc',
    ctaKey: 'pages.home.viewAllCityLink',
  },
  {
    id: 'resources',
    href: '/resources',
    titleKey: 'pages.home.starterStep3Title',
    descKey: 'pages.home.starterStep3Desc',
    ctaKey: 'header.resources',
  },
]

describe('HomeStarterSteps', () => {
  it('renders starter title and locale-aware links', () => {
    render(<HomeStarterSteps steps={steps} locale="en" />)

    expect(screen.getByRole('heading', { name: 'Start Here' })).toBeInTheDocument()

    expect(screen.getByRole('link', { name: 'Browse Full Anime Index →' })).toHaveAttribute('href', '/en/anime')
    expect(screen.getByRole('link', { name: 'View All Cities →' })).toHaveAttribute('href', '/en/city')
    expect(screen.getByRole('link', { name: 'Resources' })).toHaveAttribute('href', '/en/resources')
  })

  it('renders nothing when list is empty', () => {
    const { container } = render(<HomeStarterSteps steps={[]} locale="en" />)
    expect(container.firstChild).toBeNull()
  })
})
