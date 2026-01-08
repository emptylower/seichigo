import { describe, expect, it, vi, beforeEach } from 'vitest'

const getAnimeByIdMock = vi.fn()
vi.mock('@/lib/anime/getAllAnime', () => ({
  getAnimeById: (...args: any[]) => getAnimeByIdMock(...args),
}))

const getPostsByAnimeIdMock = vi.fn()
vi.mock('@/lib/posts/getPostsByAnimeId', () => ({
  getPostsByAnimeId: (...args: any[]) => getPostsByAnimeIdMock(...args),
}))

describe('anime metadata', () => {
  beforeEach(() => {
    getAnimeByIdMock.mockReset()
    getPostsByAnimeIdMock.mockReset()
  })

  it('sets title/description/canonical for anime detail', async () => {
    getAnimeByIdMock.mockResolvedValueOnce({
      id: 'btr',
      name: 'Bocchi the Rock!',
      summary: '示例简介',
      alias: ['孤独摇滚'],
    })
    getPostsByAnimeIdMock.mockResolvedValueOnce([{ path: '/posts/x', title: 'x', animeIds: ['btr'], city: '', tags: [], source: 'mdx' }])

    const { generateMetadata } = await import('@/app/(site)/anime/[id]/page')
    const meta = await generateMetadata({ params: Promise.resolve({ id: 'btr' }) })

    expect(meta.title).toBe('Bocchi the Rock!')
    expect(meta.description).toContain('示例简介')
    expect(meta.alternates?.canonical).toBe('/anime/btr')
  })
})

