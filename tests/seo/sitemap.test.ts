import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getAllPublicPostsStrict: vi.fn(),
  getAllAnimeStrict: vi.fn(),
  listCitiesForIndex: vi.fn(),
  getAllLinkAssets: vi.fn(),
}))

vi.mock('@/lib/posts/getAllPublicPosts', () => ({
  getAllPublicPostsStrict: mocks.getAllPublicPostsStrict,
}))

vi.mock('@/lib/anime/getAllAnime', () => ({
  getAllAnimeStrict: mocks.getAllAnimeStrict,
}))

vi.mock('@/lib/city/db', () => ({
  listCitiesForIndex: mocks.listCitiesForIndex,
}))

vi.mock('@/lib/linkAsset/getAllLinkAssets', () => ({
  getAllLinkAssets: mocks.getAllLinkAssets,
}))

vi.mock('@/lib/seo/site', () => ({
  getSiteOrigin: () => 'https://seichigo.test',
}))

import sitemap, { revalidate } from '@/app/sitemap'

describe('sitemap strict data sources', () => {
  const originalDatabaseUrl = process.env.DATABASE_URL

  beforeEach(() => {
    vi.resetAllMocks()
    process.env.DATABASE_URL = 'mock'
    mocks.getAllPublicPostsStrict.mockResolvedValue([])
    mocks.getAllAnimeStrict.mockResolvedValue([])
    mocks.listCitiesForIndex.mockResolvedValue([])
    mocks.getAllLinkAssets.mockResolvedValue([])
  })

  afterAll(() => {
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = originalDatabaseUrl
  })

  it('uses the strict cache-aligned revalidation interval', () => {
    expect(revalidate).toBe(120)
  })

  it.each([
    ['Chinese posts', (reason: Error) => mocks.getAllPublicPostsStrict.mockImplementation(async (locale: string) => {
      if (locale === 'zh') throw reason
      return []
    })],
    ['English posts', (reason: Error) => mocks.getAllPublicPostsStrict.mockImplementation(async (locale: string) => {
      if (locale === 'en') throw reason
      return []
    })],
    ['Japanese posts', (reason: Error) => mocks.getAllPublicPostsStrict.mockImplementation(async (locale: string) => {
      if (locale === 'ja') throw reason
      return []
    })],
    ['anime', (reason: Error) => mocks.getAllAnimeStrict.mockRejectedValue(reason)],
    ['cities', (reason: Error) => mocks.listCitiesForIndex.mockRejectedValue(reason)],
    ['resources', (reason: Error) => mocks.getAllLinkAssets.mockRejectedValue(reason)],
  ] as const)('rejects when %s fail', async (source, fail) => {
    const reason = new Error(`${source} unavailable`)
    fail(reason)

    await expect(sitemap()).rejects.toBe(reason)
  })

  it('skips the city database loader when DATABASE_URL is not configured', async () => {
    delete process.env.DATABASE_URL

    await expect(sitemap()).resolves.toEqual(expect.any(Array))
    expect(mocks.listCitiesForIndex).not.toHaveBeenCalled()
  })
})
