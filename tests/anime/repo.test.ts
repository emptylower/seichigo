import { describe, expect, it, vi, beforeEach } from 'vitest'
import { getAllAnime } from '@/lib/anime/getAllAnime'

const mocks = vi.hoisted(() => ({
  prisma: {
    anime: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}))

vi.mock('next/cache', () => ({
  unstable_cache: (fn: (...args: unknown[]) => unknown) => fn,
}))

vi.mock('@/lib/db/prisma', () => ({
  prisma: mocks.prisma,
}))

describe('getAllAnime', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    process.env.DATABASE_URL = 'mock'
  })

  const baseList = [
    { id: 'a', name: 'File A' },
    { id: 'b', name: 'File B' },
  ]

  it('merges file and db records', async () => {
    mocks.prisma.anime.findMany.mockResolvedValue([
      { id: 'a', name: 'DB A', hidden: false },
      { id: 'b', name: 'DB B', hidden: false },
    ])

    const result = await getAllAnime({ baseList })
    expect(result).toHaveLength(2)
    const a = result.find((x) => x.id === 'a')
    expect(a?.name).toBe('DB A') // DB overrides file
    const b = result.find((x) => x.id === 'b')
    expect(b?.name).toBe('DB B') // DB only
  })

  it('hides records marked as hidden in DB', async () => {
    mocks.prisma.anime.findMany.mockResolvedValue([
      { id: 'a', name: 'DB A', hidden: true },
    ])

    const result = await getAllAnime({ baseList })
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('b')
  })

  it('includes hidden records if requested', async () => {
    mocks.prisma.anime.findMany.mockResolvedValue([
      { id: 'a', name: 'DB A', hidden: true },
    ])

    const result = await getAllAnime({ includeHidden: true, baseList })
    expect(result).toHaveLength(2)
    expect(result.find((anime) => anime.id === 'a')?.hidden).toBe(true)
    expect(result.find((anime) => anime.id === 'b')?.hidden).toBeFalsy()
  })

  it('hides legacy id entries shadowed by visible db alias ids', async () => {
    mocks.prisma.anime.findMany.mockResolvedValue([
      { id: 'bocchi-the-rock', name: '孤独摇滚!', alias: ['btr'], hidden: false },
    ])

    const result = await getAllAnime({ baseList: [{ id: 'btr', name: 'Bocchi the Rock (file)' }] })
    expect(result.find((x) => x.id === 'bocchi-the-rock')).toBeTruthy()
    expect(result.find((x) => x.id === 'btr')).toBeFalsy()
  })

  it('falls back to db records when the bundled base list is empty', async () => {
    mocks.prisma.anime.findMany.mockResolvedValue([
      { id: 'your-name', name: '你的名字', hidden: false, cover: '/assets/your-name' },
    ])

    const result = await getAllAnime({ baseList: [] })

    expect(result).toEqual([
      expect.objectContaining({
        id: 'your-name',
        name: '你的名字',
        cover: '/assets/your-name',
      }),
    ])
  })
})
