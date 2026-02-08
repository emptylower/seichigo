import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import HomePopularCities from '@/components/home/HomePopularCities'
import type { HomePopularCityItem } from '@/lib/home/types'

vi.mock('@/components/city/CityCard', () => ({
  default: function MockCityCard({ city, postCount }: { city: { name_zh: string }; postCount: number }) {
    return <div data-testid="city-card">{city.name_zh}:{postCount}</div>
  },
}))

describe('HomePopularCities', () => {
  const items: HomePopularCityItem[] = [
    {
      city: {
        id: 'tokyo',
        slug: 'tokyo',
        name_zh: '东京',
        name_en: 'Tokyo',
        name_ja: '東京',
        description_zh: null,
        description_en: null,
        description_ja: null,
        transportTips_zh: null,
        transportTips_en: null,
        transportTips_ja: null,
        cover: null,
        needsReview: false,
        hidden: false,
      },
      postCount: 5,
    },
    {
      city: {
        id: 'kyoto',
        slug: 'kyoto',
        name_zh: '京都',
        name_en: 'Kyoto',
        name_ja: '京都',
        description_zh: null,
        description_en: null,
        description_ja: null,
        transportTips_zh: null,
        transportTips_en: null,
        transportTips_ja: null,
        cover: null,
        needsReview: false,
        hidden: false,
      },
      postCount: 2,
    },
  ]

  it('renders section title, cards and index link', () => {
    render(<HomePopularCities items={items} locale="en" />)

    expect(screen.getByRole('heading', { name: 'Popular Cities' })).toBeInTheDocument()
    expect(screen.getAllByTestId('city-card')).toHaveLength(2)

    const link = screen.getByRole('link', { name: 'View All Cities →' })
    expect(link).toHaveAttribute('href', '/en/city')
  })

  it('renders nothing when list is empty', () => {
    const { container } = render(<HomePopularCities items={[]} locale="en" />)
    expect(container.firstChild).toBeNull()
  })
})
