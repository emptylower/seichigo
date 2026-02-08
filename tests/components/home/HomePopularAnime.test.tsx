import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import HomePopularAnime from '@/components/home/HomePopularAnime'
import type { HomePopularAnimeItem } from '@/lib/home/types'

vi.mock('@/components/anime/AnimeCard', () => ({
  default: function MockAnimeCard({ anime, postCount }: { anime: { name: string }; postCount: number }) {
    return <div data-testid="anime-card">{anime.name}:{postCount}</div>
  },
}))

describe('HomePopularAnime', () => {
  const items: HomePopularAnimeItem[] = [
    {
      anime: { id: 'alpha', name: 'Alpha' },
      postCount: 4,
      cover: null,
    },
    {
      anime: { id: 'beta', name: 'Beta' },
      postCount: 2,
      cover: null,
    },
  ]

  it('renders section title, cards and index link', () => {
    render(<HomePopularAnime items={items} locale="en" />)

    expect(screen.getByRole('heading', { name: 'Popular Anime' })).toBeInTheDocument()
    expect(screen.getAllByTestId('anime-card')).toHaveLength(2)

    const link = screen.getByRole('link', { name: 'Browse Full Anime Index →' })
    expect(link).toHaveAttribute('href', '/en/anime')
  })

  it('renders nothing when list is empty', () => {
    const { container } = render(<HomePopularAnime items={[]} locale="en" />)
    expect(container.firstChild).toBeNull()
  })
})
