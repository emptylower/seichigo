import { beforeEach, describe, expect, it, vi } from 'vitest'

type CachedFunction = (...args: unknown[]) => Promise<unknown>

const mocks = vi.hoisted(() => {
  const cache = new Map<string, Promise<unknown>>()

  return {
    cache,
    getBootstrap: vi.fn(),
    prisma: { marker: 'prisma' },
    unstableCache: vi.fn(
      (fn: CachedFunction, keyParts: string[], options: { revalidate: number }) => {
        return (...args: unknown[]) => {
          const key = JSON.stringify([keyParts, args])
          const cached = cache.get(key)
          if (cached) return cached

          const pending = fn(...args)
          cache.set(key, pending)
          return pending
        }
      }
    ),
  }
})

vi.mock('next/cache', () => ({
  unstable_cache: mocks.unstableCache,
}))

vi.mock('@/lib/anitabi/read', () => ({
  getBootstrap: mocks.getBootstrap,
}))

vi.mock('@/lib/db/prisma', () => ({
  prisma: mocks.prisma,
}))

import { getMapPageBootstrap } from '@/lib/anitabi/mapPageBootstrap'

describe('getMapPageBootstrap', () => {
  beforeEach(() => {
    mocks.cache.clear()
    mocks.getBootstrap.mockReset().mockImplementation(async ({ locale, tab }) => ({
      locale,
      tab,
    }))
  })

  it('caches repeated page bootstrap reads for the same locale and tab', async () => {
    const first = await getMapPageBootstrap('ja', 'latest')
    const second = await getMapPageBootstrap('ja', 'latest')

    expect(first).toEqual({ locale: 'ja', tab: 'latest' })
    expect(second).toEqual(first)
    expect(mocks.getBootstrap).toHaveBeenCalledTimes(1)
    expect(mocks.getBootstrap).toHaveBeenCalledWith({
      prisma: mocks.prisma,
      locale: 'ja',
      tab: 'latest',
    })
  })

  it('uses locale and tab as separate cache-key dimensions', async () => {
    await getMapPageBootstrap('ja', 'latest')
    await getMapPageBootstrap('en', 'latest')
    await getMapPageBootstrap('ja', 'hot')

    expect(mocks.getBootstrap).toHaveBeenCalledTimes(3)
  })

  it('sets a five-minute revalidation window', () => {
    expect(mocks.unstableCache).toHaveBeenCalledWith(
      expect.any(Function),
      ['anitabi:map-page-bootstrap'],
      { revalidate: 300 }
    )
  })
})
