import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CityLite } from '@/lib/city/db'
import { HomeDataSourceError } from '@/lib/home/dataSourceError'
import { getHomePortalData, HOME_DATA_TIMEOUT_MS } from '@/lib/home/getHomePortalData'
import { readHomeMapClustersFile, readHomeShowcaseFile } from '@/lib/home/generatedHomeFiles'
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

const homeStatsFixture = { points: 12_345, works: 678, cities: 3, posts: 9 }

const showcaseFixture = {
  revisionId: 'rev-1',
  savedAt: '2026-09-05T00:00:00.000Z',
  title: '东京 8 日巡礼',
  summary: '一段助手摘要',
  days: [],
}

const mapClustersFixture = {
  generatedAt: '2026-09-05T00:00:00.000Z',
  totalPoints: 12_345,
  cells: [{ lng: 139.65, lat: 35.65, count: 42 }],
}

const heroDemoFixture = {
  planTitle: '你的名字 东京巡礼 8 日',
  day: {
    dayIndex: 2,
    summary: '新宿一带',
    items: [
      {
        id: 'a',
        title: '须贺神社男坂',
        titles: { zh: '须贺神社男坂', en: 'Suga Shrine Menstair', ja: '須賀神社男坂' },
        time: '09:30',
        imageUrl: '/images/showcase/a.jpg',
        lat: 35.7013,
        lng: 139.7966,
      },
      {
        id: 'b',
        title: '信浓町步道桥',
        titles: { zh: '信浓町步道桥', en: 'Shinanomachi Pedestrian Bridge', ja: '信濃町歩道橋' },
        time: '10:20',
        imageUrl: '/images/showcase/b.jpg',
        lat: 35.6985,
        lng: 139.7982,
      },
      {
        id: 'c',
        title: '四谷见附桥',
        titles: { zh: '四谷见附桥', en: 'Yotsuya Mitsuke Bridge', ja: '四谷見附橋' },
        time: '11:10',
        imageUrl: '/images/showcase/c.jpg',
        lat: 35.6856,
        lng: 139.7361,
      },
    ],
    transit: [
      { fromId: 'a', toId: 'b', mode: 'walk', label: '步行 12 分钟' },
      { fromId: 'b', toId: 'c', mode: 'train', label: '电车 8 分钟' },
    ],
  },
}

const generatedDeps = {
  getHomeStats: async () => ({ ...homeStatsFixture }),
  readHomeShowcase: async () => JSON.parse(JSON.stringify(showcaseFixture)) as typeof showcaseFixture,
  readHomeMapClusters: async () => JSON.parse(JSON.stringify(mapClustersFixture)) as typeof mapClustersFixture,
  readHomeHeroDemo: async () => JSON.parse(JSON.stringify(heroDemoFixture)) as typeof heroDemoFixture,
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
      ...generatedDeps,
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
        ...generatedDeps,
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
      ...generatedDeps,
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
      ...generatedDeps,
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
      ...generatedDeps,
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
      ...generatedDeps,
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
      ...generatedDeps,
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
      ...generatedDeps,
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
      ...generatedDeps,
      getAllPublicPosts: async () => [makePost({ path: '/ja/posts/real-1', animeIds: ['alpha'] })],
      getAllAnime: async () => [{ id: 'alpha', name: 'Alpha', cover: '/assets/alpha' }],
      getCityCountsByLocale: async () => ({ cities: [], counts: {} }),
    })

    expect(data.popularCities).toEqual([])
  })

  it('no longer ships the unrendered heroDisplay/more/starterSteps fields', async () => {
    const data = await getHomePortalData('zh', {
      ...generatedDeps,
      getAllPublicPosts: async () => [makePost({ path: '/posts/real-1', animeIds: ['alpha'] })],
      getAllAnime: async () => [{ id: 'alpha', name: 'Alpha' }],
      getCityCountsByLocale: async () => ({ cities: [], counts: {} }),
    })

    expect(data).not.toHaveProperty('heroDisplay')
    expect(data).not.toHaveProperty('more')
    expect(data).not.toHaveProperty('starterSteps')
  })

  it('exposes stats, showcase, map clusters and hero demo from the generated home sources', async () => {
    const data = await getHomePortalData('en', {
      ...generatedDeps,
      getAllPublicPosts: async () => [],
      getAllAnime: async () => [],
      getCityCountsByLocale: async () => ({ cities: [], counts: {} }),
    })

    expect(data.stats).toEqual(homeStatsFixture)
    expect(data.showcase).toEqual(showcaseFixture)
    expect(data.mapClusters).toEqual(mapClustersFixture)
    expect(data.heroDemo).toEqual(heroDemoFixture)
  })

  it('rejects the render when the hero demo source fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const promise = getHomePortalData('en', {
      ...generatedDeps,
      getAllPublicPosts: async () => [],
      getAllAnime: async () => [],
      getCityCountsByLocale: async () => ({ cities: [], counts: {} }),
      readHomeHeroDemo: async () => {
        throw new Error('hero demo unavailable')
      },
    })

    await expect(promise).rejects.toThrow(
      '[home:portal-unavailable] locale=en failures=home.heroDemo:failure'
    )
  })

  it('passes the page locale through to getHomeStats so posts are counted per locale', async () => {
    const calls: string[] = []
    const data = await getHomePortalData('ja', {
      ...generatedDeps,
      getAllPublicPosts: async () => [],
      getAllAnime: async () => [],
      getCityCountsByLocale: async () => ({ cities: [], counts: {} }),
      getHomeStats: async (locale) => {
        calls.push(locale)
        return { ...homeStatsFixture }
      },
    })

    expect(calls).toEqual(['ja'])
    expect(data.stats).toEqual(homeStatsFixture)
  })

  it('rejects the render when the showcase payload has an invalid shape', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const promise = getHomePortalData('en', {
      ...generatedDeps,
      getAllPublicPosts: async () => [],
      getAllAnime: async () => [],
      getCityCountsByLocale: async () => ({ cities: [], counts: {} }),
      readHomeShowcase: async () => readHomeShowcaseFile({ revisionId: '', savedAt: '', title: '', days: [] }),
    })

    await expect(promise).rejects.toThrow(
      '[home:portal-unavailable] locale=en failures=home.showcase:failure'
    )
    expect(consoleError).toHaveBeenCalledWith(
      '[home:data-source-error] locale=en source=home.showcase kind=failure',
      expect.any(Error)
    )
  })

  it('rejects the render when the map clusters payload has an invalid shape', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const promise = getHomePortalData('en', {
      ...generatedDeps,
      getAllPublicPosts: async () => [],
      getAllAnime: async () => [],
      getCityCountsByLocale: async () => ({ cities: [], counts: {} }),
      readHomeMapClusters: async () => readHomeMapClustersFile({ generatedAt: '', totalPoints: -1, cells: [] }),
    })

    await expect(promise).rejects.toThrow(
      '[home:portal-unavailable] locale=en failures=home.mapClusters:failure'
    )
  })

  it('rejects the render when the stats source fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const promise = getHomePortalData('en', {
      ...generatedDeps,
      getAllPublicPosts: async () => [],
      getAllAnime: async () => [],
      getCityCountsByLocale: async () => ({ cities: [], counts: {} }),
      getHomeStats: async () => {
        throw new Error('counts unavailable')
      },
    })

    await expect(promise).rejects.toThrow(
      '[home:portal-unavailable] locale=en failures=home.stats:failure'
    )
  })

  it('includes pinned-work articles outside the latest 12 shelf at the front of guides', async () => {
    const fillers = Array.from({ length: 17 }, (_, i) =>
      makePost({ path: `/posts/filler-${i}`, title: `filler ${i}` })
    )
    const pinned = [
      makePost({ path: '/posts/your-name-1', title: 'Your Name. Guide: Shibuya', animeIds: ['Your Name'] }),
      makePost({ path: '/posts/your-name-2', title: 'Your Name. Guide: Hida', animeIds: ['Your Name'] }),
      makePost({ path: '/posts/your-name-3', title: 'Your Name. Guide: Suwa', animeIds: ['Your Name'] }),
    ]
    const posts = [...fillers.slice(0, 14), ...pinned, ...fillers.slice(14)]

    const data = await getHomePortalData('en', {
      ...generatedDeps,
      getAllPublicPosts: async () => posts,
      getAllAnime: async () => [],
      getCityCountsByLocale: async () => ({ cities: [], counts: {} }),
    })

    expect(data.guides.slice(0, 3).map((p) => p.path)).toEqual([
      '/posts/your-name-1',
      '/posts/your-name-2',
      '/posts/your-name-3',
    ])
    expect(data.guides).toHaveLength(8)
  })

  it('picks up to 8 guides from featured and latest, routeLength+cover first within the misc pool', async () => {
    const posts = [
      makePost({ path: '/posts/featured', title: 'featured bare' }),
      makePost({ path: '/posts/both', title: 'both', routeLength: '3 天', cover: '/c.png' }),
      makePost({ path: '/posts/length-only', title: 'length only', routeLength: '2 天' }),
      makePost({ path: '/posts/cover-only', title: 'cover only', cover: '/c2.png' }),
      ...Array.from({ length: 10 }, (_, i) => makePost({ path: `/posts/filler-${i}`, title: `filler ${i}` })),
    ]

    const data = await getHomePortalData('en', {
      ...generatedDeps,
      getAllPublicPosts: async () => posts,
      getAllAnime: async () => [],
      getCityCountsByLocale: async () => ({ cities: [], counts: {} }),
    })

    expect(data.guides).toHaveLength(8)
    expect(data.guides.slice(0, 1).map((p) => p.path)).toEqual(['/posts/both'])
    expect(data.guides.slice(1).map((p) => p.path)).toEqual([
      '/posts/featured',
      '/posts/length-only',
      '/posts/cover-only',
      '/posts/filler-0',
      '/posts/filler-1',
      '/posts/filler-2',
      '/posts/filler-3',
    ])
  })
})
