import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HomeDataSourceError } from '@/lib/home/dataSourceError'
import {
  getCityCountsByLocale,
  getCityCountsByLocaleForHome,
  getCityCountsByLocaleStrict,
} from '@/lib/city/getCityCountsByLocale'

const mocks = vi.hoisted(() => ({
  listCitiesForIndex: vi.fn(),
  countPublishedArticlesByCityIds: vi.fn(),
  findAliases: vi.fn(),
  getAllPublicPosts: vi.fn(),
  getAllPublicPostsStrict: vi.fn(),
}))

vi.mock('next/cache', () => ({
  unstable_cache: (fn: (...args: unknown[]) => unknown) => fn,
}))

vi.mock('@/lib/city/db', () => ({
  listCitiesForIndex: mocks.listCitiesForIndex,
  countPublishedArticlesByCityIds: mocks.countPublishedArticlesByCityIds,
}))

vi.mock('@/lib/db/prisma', () => ({
  prisma: { cityAlias: { findMany: mocks.findAliases } },
}))

vi.mock('@/lib/posts/getAllPublicPosts', () => ({
  getAllPublicPosts: mocks.getAllPublicPosts,
  getAllPublicPostsStrict: mocks.getAllPublicPostsStrict,
}))

describe('getCityCountsByLocale home strict mode', () => {
  const originalDatabaseUrl = process.env.DATABASE_URL
  const city = {
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
  }

  beforeEach(() => {
    vi.resetAllMocks()
    process.env.DATABASE_URL = 'mock'
    mocks.listCitiesForIndex.mockResolvedValue([city])
    mocks.countPublishedArticlesByCityIds.mockResolvedValue({})
    mocks.findAliases.mockResolvedValue([])
    mocks.getAllPublicPosts.mockResolvedValue([])
    mocks.getAllPublicPostsStrict.mockResolvedValue([])
  })

  afterEach(() => {
    process.env.DATABASE_URL = originalDatabaseUrl
  })

  it('keeps the existing empty fallback for non-home callers', async () => {
    mocks.listCitiesForIndex.mockRejectedValue(new Error('database unavailable'))

    await expect(getCityCountsByLocale('en')).resolves.toEqual({ cities: [], counts: {} })
  })

  it('skips database sources when the database is not configured', async () => {
    delete process.env.DATABASE_URL

    await expect(getCityCountsByLocaleForHome('en')).resolves.toEqual({ cities: [], counts: {} })
    expect(mocks.listCitiesForIndex).not.toHaveBeenCalled()
  })

  it('accepts a successful empty city query', async () => {
    mocks.listCitiesForIndex.mockResolvedValue([])

    await expect(getCityCountsByLocaleStrict('en', {
      listCitiesForIndex: mocks.listCitiesForIndex,
    })).resolves.toEqual({ cities: [], counts: {} })
  })

  it('propagates an injected strict source failure', async () => {
    const reason = new Error('injected city source failed')

    await expect(getCityCountsByLocaleStrict('en', {
      listCitiesForIndex: async () => { throw reason },
    })).rejects.toMatchObject({
      source: 'city.list',
      kind: 'failure',
      reason,
    })
  })

  it.each([
    ['city.list', () => mocks.listCitiesForIndex.mockRejectedValue(new Error('list failed'))],
    ['city.article-counts', () => mocks.countPublishedArticlesByCityIds.mockRejectedValue(new Error('counts failed'))],
    ['city.aliases', () => mocks.findAliases.mockRejectedValue(new Error('aliases failed'))],
    ['city.public-posts', () => mocks.getAllPublicPostsStrict.mockRejectedValue(new Error('posts failed'))],
  ])('rejects instead of returning partial data when %s fails', async (source, fail) => {
    fail()

    await expect(getCityCountsByLocaleStrict('en')).rejects.toMatchObject({
      source,
      kind: 'failure',
      reason: expect.any(Error),
    })
  })

  it('preserves a nested strict posts error and its original reason', async () => {
    const reason = new Error('posts database failed')
    mocks.getAllPublicPostsStrict.mockRejectedValue(
      new HomeDataSourceError('posts.database', 'failure', reason)
    )

    await expect(getCityCountsByLocaleStrict('en')).rejects.toMatchObject({
      source: 'posts.database',
      kind: 'failure',
      reason,
    })
  })
})
