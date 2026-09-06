import { describe, expect, it, vi } from 'vitest'
import type { CityLite } from '@/lib/city/db'
import { prisma } from '@/lib/db/prisma'
import { HomeDataSourceError } from '@/lib/home/dataSourceError'
import { defaultHomeStatsDeps, getHomeStats } from '@/lib/home/getHomeStats'
import { getAllPublicPostsForHome } from '@/lib/posts/getAllPublicPosts'
import type { PublicPostListItem } from '@/lib/posts/types'

vi.mock('@/lib/posts/getAllPublicPosts', () => ({
  getAllPublicPostsForHome: vi.fn(async (locale: string): Promise<PublicPostListItem[]> => [
    {
      source: 'db',
      path: `/${locale}/posts/p1`,
      title: 'p1',
      animeIds: [],
      city: '',
      tags: [],
    },
  ]),
}))

function makeCity(id: string): CityLite {
  return {
    id,
    slug: id,
    name_zh: `城市${id}`,
    name_en: null,
    name_ja: null,
    description_zh: null,
    description_en: null,
    description_ja: null,
    transportTips_zh: null,
    transportTips_en: null,
    transportTips_ja: null,
    cover: null,
    needsReview: false,
    hidden: false,
  }
}

function makePost(tags: string[] = []): PublicPostListItem {
  return {
    source: 'db',
    path: `/posts/${Math.random()}`,
    title: 'post',
    animeIds: [],
    city: '',
    tags,
  }
}

const healthyDeps = {
  countPoints: async () => 12_345,
  countWorks: async () => 678,
  listCities: async () => [makeCity('city-1'), makeCity('city-2'), makeCity('city-3')],
  loadPublicPosts: async () => [
    makePost(),
    makePost(['东京']),
    makePost(['seo-spoke']),
    makePost(['seo-spoke']),
  ],
}

describe('getHomeStats', () => {
  it('aggregates the four counters into one stats object', async () => {
    const stats = await getHomeStats('zh', healthyDeps)

    expect(stats).toEqual({ points: 12_345, works: 678, cities: 3, posts: 2 })
  })

  it('counts only points that actually have coordinates (same criteria as clusters totalPoints)', async () => {
    const countSpy = vi.fn(async () => 5)
    const prismaStub = prisma as unknown as { anitabiPoint?: unknown }
    const original = prismaStub.anitabiPoint
    prismaStub.anitabiPoint = { count: countSpy }

    try {
      const deps = defaultHomeStatsDeps('zh')
      await expect(deps.countPoints()).resolves.toBe(5)
    } finally {
      if (original === undefined) delete prismaStub.anitabiPoint
      else prismaStub.anitabiPoint = original
    }

    expect(countSpy).toHaveBeenCalledTimes(1)
    expect(countSpy).toHaveBeenCalledWith({
      where: { geoLat: { not: null }, geoLng: { not: null } },
    })
  })

  it('counts public posts per locale via the default deps', async () => {
    for (const locale of ['zh', 'en', 'ja'] as const) {
      const posts = await defaultHomeStatsDeps(locale).loadPublicPosts()
      expect(posts[0]!.path).toBe(`/${locale}/posts/p1`)
    }
    expect(getAllPublicPostsForHome).toHaveBeenCalledWith('zh')
    expect(getAllPublicPostsForHome).toHaveBeenCalledWith('en')
    expect(getAllPublicPostsForHome).toHaveBeenCalledWith('ja')
  })

  it.each([
    ['countPoints', 'home.stats.points'],
    ['countWorks', 'home.stats.works'],
    ['listCities', 'home.stats.cities'],
    ['loadPublicPosts', 'home.stats.posts'],
  ] as const)('rejects when %s fails instead of degrading the cache', async (key, source) => {
    await expect(getHomeStats('zh', {
      ...healthyDeps,
      [key]: async () => {
        throw new Error('count boom')
      },
    })).rejects.toMatchObject({
      name: 'HomeDataSourceError',
      source,
      kind: 'failure',
    })
  })

  it('exposes HomeDataSourceError so portal failures keep their diagnostics', async () => {
    const promise = getHomeStats('zh', {
      ...healthyDeps,
      countPoints: async () => {
        throw new Error('connection refused')
      },
    })

    await expect(promise).rejects.toBeInstanceOf(HomeDataSourceError)
    await expect(promise).rejects.toThrow('[home:data-source-error] source=home.stats.points')
  })
})
