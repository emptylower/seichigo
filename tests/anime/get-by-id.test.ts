import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getAnimeById } from '@/lib/anime/getAllAnime'

const mocks = vi.hoisted(() => ({
  prisma: {
    anime: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
  },
}))

vi.mock('next/cache', () => ({
  unstable_cache: (fn: (...args: unknown[]) => unknown) => fn,
}))

vi.mock('@/lib/db/prisma', () => ({
  prisma: mocks.prisma,
}))

describe('getAnimeById', () => {
  const originalDatabaseUrl = process.env.DATABASE_URL

  beforeEach(() => {
    vi.resetAllMocks()
    process.env.DATABASE_URL = 'mock'
  })

  afterEach(() => {
    process.env.DATABASE_URL = originalDatabaseUrl
    vi.restoreAllMocks()
  })

  const baseList = [{ id: 'btr', name: 'Bocchi the Rock (file)' }]

  it('resolves by exact id from the database', async () => {
    mocks.prisma.anime.findUnique.mockResolvedValue({
      id: 'your-name',
      name: '君の名は。',
      alias: ['你的名字'],
      hidden: false,
    })

    const result = await getAnimeById('your-name', { baseList })
    expect(result).toMatchObject({ id: 'your-name', name: '君の名は。', alias: ['你的名字'] })
    expect(mocks.prisma.anime.findMany).not.toHaveBeenCalled()
  })

  it('falls back to alias lookup when the id misses', async () => {
    mocks.prisma.anime.findUnique.mockResolvedValue(null)
    mocks.prisma.anime.findMany.mockResolvedValue([
      { id: 'your-name', name: '君の名は。', alias: ['你的名字'], hidden: false },
    ])

    const result = await getAnimeById('你的名字', { baseList })
    expect(result).toMatchObject({ id: 'your-name', name: '君の名は。' })
    expect(mocks.prisma.anime.findMany).toHaveBeenCalledWith({ where: { alias: { has: '你的名字' } } })
  })

  it('returns null when neither id nor alias matches', async () => {
    mocks.prisma.anime.findUnique.mockResolvedValue(null)
    mocks.prisma.anime.findMany.mockResolvedValue([])

    await expect(getAnimeById('完全不存在的作品', { baseList })).resolves.toBeNull()
  })

  it('keeps hidden anime invisible via alias fallback unless includeHidden is set', async () => {
    mocks.prisma.anime.findUnique.mockResolvedValue(null)
    mocks.prisma.anime.findMany.mockResolvedValue([
      { id: 'secret-work', name: '秘密作品', alias: ['隐之作'], hidden: true },
    ])

    await expect(getAnimeById('隐之作', { baseList })).resolves.toBeNull()

    const visible = await getAnimeById('隐之作', { baseList, includeHidden: true })
    expect(visible).toMatchObject({ id: 'secret-work', hidden: true })
  })

  it('keeps hidden anime invisible on exact id unless includeHidden is set', async () => {
    mocks.prisma.anime.findUnique.mockResolvedValue({ id: 'secret-work', name: '秘密作品', hidden: true })

    await expect(getAnimeById('secret-work', { baseList })).resolves.toBeNull()

    const visible = await getAnimeById('secret-work', { baseList, includeHidden: true })
    expect(visible).toMatchObject({ id: 'secret-work', hidden: true })
  })

  it('takes the first row and warns when several rows share the alias', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    mocks.prisma.anime.findUnique.mockResolvedValue(null)
    mocks.prisma.anime.findMany.mockResolvedValue([
      { id: 'your-name', name: '第一行', alias: ['你的名字'], hidden: false },
      { id: 'your-name-2', name: '第二行', alias: ['你的名字'], hidden: false },
    ])

    const result = await getAnimeById('你的名字', { baseList })
    expect(result).toMatchObject({ id: 'your-name' })
    expect(warnSpy).toHaveBeenCalledWith(
      '[anime.by-id-alias-multiple]',
      expect.objectContaining({ id: '你的名字', matchedIds: ['your-name', 'your-name-2'] })
    )
  })

  it('falls back to the bundled list when the database has no match', async () => {
    mocks.prisma.anime.findUnique.mockResolvedValue(null)
    mocks.prisma.anime.findMany.mockResolvedValue([])

    await expect(getAnimeById('btr', { baseList })).resolves.toEqual({ id: 'btr', name: 'Bocchi the Rock (file)' })
  })
})
