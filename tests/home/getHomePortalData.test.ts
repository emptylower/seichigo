import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CityLite } from '@/lib/city/db'
import { HomeDataSourceError } from '@/lib/home/dataSourceError'
import { getHomePortalData, HOME_DATA_TIMEOUT_MS } from '@/lib/home/getHomePortalData'
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

function makeCity(overrides: Partial<CityLite> = {}): CityLite {
  return {
    id: 'city-1',
    slug: 'city-1',
    name_zh: '城市',
    name_en: 'City',
    name_ja: '都市',
    description_zh: null,
    description_en: null,
    description_ja: null,
    transportTips_zh: null,
    transportTips_en: null,
    transportTips_ja: null,
    cover: null,
    needsReview: false,
    hidden: false,
    ...overrides,
  }
}

describe('getHomePortalData', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it.each([
    ['posts.aggregate', 'getAllPublicPosts', {
      getAllPublicPosts: async () => { throw new Error('posts unavailable') },
    }],
    ['anime.aggregate', 'getAllAnime', {
      getAllAnime: async () => { throw new Error('anime unavailable') },
    }],
    ['city.aggregate', 'getCityCountsByLocale', {
      getCityCountsByLocale: async () => { throw new Error('cities unavailable') },
    }],
  ] as const)('rejects the render when %s fails', async (source, _depName, failingDep) => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const promise = getHomePortalData('en', {
      getAllPublicPosts: async () => [],
      getAllAnime: async () => [],
      getCityCountsByLocale: async () => ({ cities: [], counts: {} }),
      ...failingDep,
    })

    await expect(promise).rejects.toThrow(
      `[home:portal-unavailable] locale=en failures=${source}:failure`
    )
    expect(consoleError).toHaveBeenCalledWith(
      `[home:data-source-error] locale=en source=${source} kind=failure`,
      expect.any(Error)
    )
  })

  it('rejects the render when a required data source times out', async () => {
    vi.useFakeTimers()
    try {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
      const promise = getHomePortalData('en', {
        getAllPublicPosts: () => new Promise<PublicPostListItem[]>(() => {}),
        getAllAnime: async () => [],
        getCityCountsByLocale: async () => ({ cities: [], counts: {} }),
      })
      const rejection = expect(promise).rejects.toThrow(
        '[home:portal-unavailable] locale=en failures=posts.aggregate:timeout'
      )

      await vi.advanceTimersByTimeAsync(HOME_DATA_TIMEOUT_MS)
      await rejection
      expect(consoleError).toHaveBeenCalledWith(
        '[home:data-source-error] locale=en source=posts.aggregate kind=timeout',
        expect.objectContaining({ message: 'posts.aggregate exceeded 15000ms' })
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('preserves strict loader diagnostics through the portal error and logs', async () => {
    const reason = new Error('postgres connection refused')
    const sourceFailure = new HomeDataSourceError('posts.database', 'failure', reason)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const promise = getHomePortalData('ja', {
      getAllPublicPosts: async () => { throw sourceFailure },
      getAllAnime: async () => [],
      getCityCountsByLocale: async () => ({ cities: [], counts: {} }),
    })

    await expect(promise).rejects.toMatchObject({
      locale: 'ja',
      failures: [sourceFailure],
    })
    expect(consoleError).toHaveBeenCalledWith(
      '[home:data-source-error] locale=ja source=posts.database kind=failure',
      reason
    )
  })

  it('accepts successful empty data sources as a genuinely empty database', async () => {
    const data = await getHomePortalData('en', {
      getAllPublicPosts: async () => [],
      getAllAnime: async () => [],
      getCityCountsByLocale: async () => ({ cities: [], counts: {} }),
    })

    expect(data.featured).toBeNull()
    expect(data.latestShelf).toEqual([])
    expect(data.popularAnime).toEqual([])
    expect(data.popularCities).toEqual([])
  })

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

  it('adds locale display names to homepage post cards without changing source ids', async () => {
    const data = await getHomePortalData('en', {
      getAllPublicPosts: async () => [makePost({ animeIds: ['中文作品'], city: '东京' })],
      getAllAnime: async () => [{ id: 'anime-1', name: '中文作品', name_en: 'English Anime' }],
      getCityCountsByLocale: async () => ({
        cities: [{
          id: 'city-1',
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
        }],
        counts: {},
      }),
    })

    expect(data.featured?.animeIds).toEqual(['中文作品'])
    expect(data.featured?.localizedAnimeNames).toEqual(['English Anime'])
    expect(data.featured?.localizedCity).toBe('Tokyo')
  })

  it('localizes known anime and city tags while preserving composite and unknown fallback text', async () => {
    const posts = [makePost({
      animeIds: ['你的名字'],
      city: '岐阜·飞驒古川 长野·诹访（上诹访）',
      tags: ['你的名字', '岐阜·飞驒古川 长野·诹访（上诹访）', '东京·未知地区', '未收录标签'],
    })]
    const anime = [{
      id: 'your-name',
      name: '你的名字',
      name_en: 'Your Name.',
      name_ja: '君の名は。',
    }]
    const cities = [
      makeCity({ id: 'gifu', slug: 'gifu', name_zh: '岐阜', name_en: 'Gifu', name_ja: '岐阜' }),
      makeCity({ id: 'hida', slug: 'hida-furukawa', name_zh: '飞驒古川', name_en: 'Hida-Furukawa', name_ja: '飛騨古川' }),
      makeCity({ id: 'nagano', slug: 'nagano', name_zh: '长野', name_en: 'Nagano', name_ja: '長野' }),
      makeCity({ id: 'suwa', slug: 'suwa', name_zh: '诹访', name_en: 'Suwa', name_ja: '諏訪' }),
      makeCity({ id: 'kamisuwa', slug: 'kamisuwa', name_zh: '上诹访', name_en: 'Kamisuwa', name_ja: '上諏訪' }),
      makeCity({ id: 'tokyo', slug: 'tokyo', name_zh: '东京', name_en: 'Tokyo', name_ja: '東京' }),
    ]
    const deps = {
      getAllPublicPosts: async () => posts,
      getAllAnime: async () => anime,
      getCityCountsByLocale: async () => ({ cities, counts: {} }),
    }

    const english = await getHomePortalData('en', deps)
    expect(english.featured?.localizedTags).toEqual([
      'Your Name.',
      'Gifu·Hida-Furukawa Nagano·Suwa（Kamisuwa）',
      'Tokyo·未知地区',
      '未收录标签',
    ])
    expect(english.featured?.tags).toEqual(posts[0]!.tags)
    expect(english.featured?.animeIds).toEqual(['你的名字'])

    const japanese = await getHomePortalData('ja', deps)
    expect(japanese.featured?.localizedTags).toEqual([
      '君の名は。',
      '岐阜·飛騨古川 長野·諏訪（上諏訪）',
      '東京·未知地区',
      '未收录标签',
    ])
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
    expect(data.heroDisplay.map(({ src }) => src)).toEqual([null, null, null])
  })
})
