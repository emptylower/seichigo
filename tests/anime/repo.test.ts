import { describe, expect, it, vi, beforeEach } from 'vitest'
import { getAllAnime } from '@/lib/anime/getAllAnime'

const mocks = vi.hoisted(() => ({
  fs: {
    readdir: vi.fn(),
    readFile: vi.fn(),
  },
  prisma: {
    anime: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}))

vi.mock('node:fs/promises', () => ({
  default: mocks.fs,
}))

vi.mock('@/lib/db/prisma', () => ({
  prisma: mocks.prisma,
}))

describe('getAllAnime', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    process.env.DATABASE_URL = 'mock'
  })

  it('merges file and db records', async () => {
    mocks.fs.readdir.mockResolvedValue(['a.json'])
    mocks.fs.readFile.mockResolvedValue(JSON.stringify({ id: 'a', name: 'File A' }))
    mocks.prisma.anime.findMany.mockResolvedValue([
      { id: 'a', name: 'DB A', hidden: false },
      { id: 'b', name: 'DB B', hidden: false },
    ])

    const result = await getAllAnime()
    expect(result).toHaveLength(2)
    const a = result.find((x) => x.id === 'a')
    expect(a?.name).toBe('DB A') // DB overrides file
    const b = result.find((x) => x.id === 'b')
    expect(b?.name).toBe('DB B') // DB only
  })

  it('hides records marked as hidden in DB', async () => {
    mocks.fs.readdir.mockResolvedValue(['a.json', 'b.json'])
    mocks.fs.readFile.mockImplementation(async (path: string) => {
      if (path.includes('a.json')) return JSON.stringify({ id: 'a', name: 'File A' })
      if (path.includes('b.json')) return JSON.stringify({ id: 'b', name: 'File B' })
      return '{}'
    })
    mocks.prisma.anime.findMany.mockResolvedValue([
      { id: 'a', name: 'DB A', hidden: true },
    ])

    const result = await getAllAnime()
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('b')
  })

  it('includes hidden records if requested', async () => {
    mocks.fs.readdir.mockResolvedValue(['a.json'])
    mocks.fs.readFile.mockResolvedValue(JSON.stringify({ id: 'a', name: 'File A' }))
    mocks.prisma.anime.findMany.mockResolvedValue([
      { id: 'a', name: 'DB A', hidden: true },
    ])

    const result = await getAllAnime({ includeHidden: true })
    expect(result).toHaveLength(1)
    expect(result[0].hidden).toBe(true)
  })

  it('hides legacy id entries shadowed by visible db alias ids', async () => {
    mocks.fs.readdir.mockResolvedValue(['btr.json'])
    mocks.fs.readFile.mockResolvedValue(JSON.stringify({ id: 'btr', name: 'Bocchi the Rock (file)' }))
    mocks.prisma.anime.findMany.mockResolvedValue([
      { id: 'bocchi-the-rock', name: '孤独摇滚!', alias: ['btr'], hidden: false },
    ])

    const result = await getAllAnime()
    expect(result.find((x) => x.id === 'bocchi-the-rock')).toBeTruthy()
    expect(result.find((x) => x.id === 'btr')).toBeFalsy()
  })
})
