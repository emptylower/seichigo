import { describe, expect, it } from 'vitest'
import { getHomePortalData } from '@/lib/home/getHomePortalData'
import type { PublicPostListItem } from '@/lib/posts/types'

function makePost(overrides: Partial<PublicPostListItem> = {}): PublicPostListItem {
  return {
    source: 'db',
    path: '/posts/default',
    title: 'default',
    animeIds: [],
    city: '',
    tags: [],
    ...overrides,
  }
}

describe('getHomePortalData', () => {
  it('filters seo spoke posts and keeps locale-prefixed public post paths', async () => {
    const posts = [
      makePost({ path: '/en/posts/seo-noise', title: 'seo noise', tags: ['seo-spoke'], animeIds: ['alpha'] }),
      makePost({ path: '/en/posts/real-1', title: 'real 1', animeIds: ['alpha'] }),
      makePost({ path: '/en/posts/real-2', title: 'real 2', animeIds: ['alpha'] }),
    ]

    const data = await getHomePortalData('en', {
      getAllPublicPosts: async () => posts,
      getAllAnime: async () => [{ id: 'alpha', name: 'Alpha', cover: '/assets/alpha' }],
      getCityCountsByLocale: async () => ({ cities: [], counts: {} }),
    })

    expect(data.featured?.path).toBe('/en/posts/real-1')
    expect(data.latestShelf).toHaveLength(2)
    expect(data.latestShelf.map((p) => p.path)).toEqual(['/en/posts/real-1', '/en/posts/real-2'])
    expect(data.latestShelf.every((p) => p.path.startsWith('/en/posts/'))).toBe(true)
  })

  it('ranks popular anime by post count then localized name and limits to 6 items', async () => {
    const anime = [
      { id: 'zeta', name: 'Zeta', cover: '/assets/zeta' },
      { id: 'alpha', name: 'Alpha', cover: '/assets/alpha' },
      { id: 'beta', name: 'Beta', cover: '/assets/beta' },
      { id: 'gamma', name: 'Gamma', cover: '/assets/gamma' },
      { id: 'delta', name: 'Delta', cover: '/assets/delta' },
      { id: 'eta', name: 'Eta', cover: '/assets/eta' },
      { id: 'theta', name: 'Theta', cover: '/assets/theta' },
    ]

    const posts = [
      makePost({ path: '/posts/1', animeIds: ['alpha'] }),
      makePost({ path: '/posts/2', animeIds: ['alpha'] }),
      makePost({ path: '/posts/3', animeIds: ['zeta'] }),
      makePost({ path: '/posts/4', animeIds: ['zeta'] }),
      makePost({ path: '/posts/5', animeIds: ['beta'] }),
      makePost({ path: '/posts/6', animeIds: ['beta'] }),
      makePost({ path: '/posts/7', animeIds: ['gamma'] }),
      makePost({ path: '/posts/8', animeIds: ['delta'] }),
      makePost({ path: '/posts/9', animeIds: ['eta'] }),
      makePost({ path: '/posts/10', animeIds: ['theta'] }),
    ]

    const data = await getHomePortalData('en', {
      getAllPublicPosts: async () => posts,
      getAllAnime: async () => anime,
      getCityCountsByLocale: async () => ({ cities: [], counts: {} }),
    })

    expect(data.popularAnime).toHaveLength(6)
    expect(data.popularAnime.slice(0, 3).map((item) => item.anime.id)).toEqual(['alpha', 'beta', 'zeta'])
    expect(data.popularAnime.map((item) => item.anime.id)).not.toContain('theta')
  })

  it('gracefully hides popular cities when city source is empty', async () => {
    const data = await getHomePortalData('ja', {
      getAllPublicPosts: async () => [makePost({ path: '/ja/posts/real-1', animeIds: ['alpha'] })],
      getAllAnime: async () => [{ id: 'alpha', name: 'Alpha', cover: '/assets/alpha' }],
      getCityCountsByLocale: async () => ({ cities: [], counts: {} }),
    })

    expect(data.popularCities).toEqual([])
  })

  it('always returns 3 hero items and fills missing covers with static fallbacks', async () => {
    const data = await getHomePortalData('zh', {
      getAllPublicPosts: async () => [makePost({ path: '/posts/real-1', animeIds: ['alpha'] })],
      getAllAnime: async () => [{ id: 'alpha', name: 'Alpha' }],
      getCityCountsByLocale: async () => ({ cities: [], counts: {} }),
    })

    expect(data.heroDisplay).toHaveLength(3)
    expect(data.heroDisplay[0]?.src).toContain('unsplash.com')
    expect(data.heroDisplay[1]?.src).toContain('unsplash.com')
    expect(data.heroDisplay[2]?.src).toContain('unsplash.com')
  })
})
