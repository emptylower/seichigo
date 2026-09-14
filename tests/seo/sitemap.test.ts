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

const base = 'https://seichigo.test'

const newStaticEntries = [
  `${base}/plan/start`,
  `${base}/en/plan/start`,
  `${base}/ja/plan/start`,
  `${base}/posts`,
  `${base}/en/posts`,
  `${base}/ja/posts`,
] as const

function languageGroupFor(path: string) {
  const zhUrl = `${base}${path}`
  const enUrl = `${base}/en${path}`
  const jaUrl = `${base}/ja${path}`
  return {
    zh: zhUrl,
    en: enUrl,
    ja: jaUrl,
    'x-default': zhUrl,
  }
}

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

  it('includes each new public entry URL exactly once', async () => {
    const urls = (await sitemap()).map((item) => item.url)

    for (const url of newStaticEntries) {
      expect(urls.filter((u) => u === url)).toHaveLength(1)
    }
  })

  it('serves the new public entry URLs without query parameters', async () => {
    const urls = (await sitemap()).map((item) => item.url)

    for (const url of newStaticEntries) {
      expect(urls.find((u) => u === url)).toBeDefined()
    }
    expect(urls.some((u) => u.includes('?'))).toBe(false)
  })

  it('declares trilingual alternates with x-default for the new public entries', async () => {
    const items = await sitemap()
    const groups: Record<string, string> = {
      [`${base}/plan/start`]: '/plan/start',
      [`${base}/en/plan/start`]: '/plan/start',
      [`${base}/ja/plan/start`]: '/plan/start',
      [`${base}/posts`]: '/posts',
      [`${base}/en/posts`]: '/posts',
      [`${base}/ja/posts`]: '/posts',
    }

    for (const [url, path] of Object.entries(groups)) {
      const entry = items.find((item) => item.url === url)
      expect(entry, `missing sitemap entry for ${url}`).toBeDefined()
      expect(entry?.alternates?.languages).toEqual(languageGroupFor(path))
    }
  })

  it('omits lastModified and priority on the new public entries', async () => {
    const items = await sitemap()

    for (const url of newStaticEntries) {
      const entry = items.find((item) => item.url === url)
      expect(entry, `missing sitemap entry for ${url}`).toBeDefined()
      expect(entry?.lastModified).toBeUndefined()
      expect(entry?.priority).toBeUndefined()
    }
  })

  it('never lists the private plan index or plan detail URLs', async () => {
    const urls = (await sitemap()).map((item) => item.url)

    expect(urls).not.toContain(`${base}/plan`)
    expect(urls).not.toContain(`${base}/en/plan`)
    expect(urls).not.toContain(`${base}/ja/plan`)

    const isPlanRoute = (u: string, prefix: string) => u === prefix || u.startsWith(`${prefix}/`)
    const planUrls = urls.filter((u) => isPlanRoute(u, `${base}/plan`) || isPlanRoute(u, `${base}/en/plan`) || isPlanRoute(u, `${base}/ja/plan`))
    expect(new Set(planUrls)).toEqual(new Set([`${base}/plan/start`, `${base}/en/plan/start`, `${base}/ja/plan/start`]))
  })
})
