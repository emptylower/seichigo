import { afterEach, describe, expect, it, vi } from 'vitest'

import { clearThrottle, isThrottled, recordTimeout, type ThrottlePrisma } from '../throttle'

const THROTTLE_KEY = { sourceType: '__throttle__', sourceId: 'global', variant: '__' } as const

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('throttle', () => {
  it('returns false when no throttle row exists', async () => {
    const findUnique = vi
      .fn<ThrottlePrisma['mapImageMirrorState']['findUnique']>()
      .mockResolvedValue(null)
    const prisma = {
      mapImageMirrorState: {
        findUnique,
        upsert: vi.fn<ThrottlePrisma['mapImageMirrorState']['upsert']>(),
        deleteMany: vi.fn<ThrottlePrisma['mapImageMirrorState']['deleteMany']>(),
      },
    } satisfies ThrottlePrisma

    await expect(isThrottled(prisma)).resolves.toBe(false)
    expect(findUnique).toHaveBeenCalledWith({
      where: { sourceType_sourceId_variant: THROTTLE_KEY },
    })
  })

  it('returns false when the throttle row has no mirroredAt timestamp', async () => {
    const prisma = {
      mapImageMirrorState: {
        findUnique: vi
          .fn<ThrottlePrisma['mapImageMirrorState']['findUnique']>()
          .mockResolvedValue({ mirroredAt: null }),
        upsert: vi.fn<ThrottlePrisma['mapImageMirrorState']['upsert']>(),
        deleteMany: vi.fn<ThrottlePrisma['mapImageMirrorState']['deleteMany']>(),
      },
    } satisfies ThrottlePrisma

    await expect(isThrottled(prisma)).resolves.toBe(false)
  })

  it('returns true when the throttle row is fresher than one hour', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-03T12:00:00Z'))

    const prisma = {
      mapImageMirrorState: {
        findUnique: vi
          .fn<ThrottlePrisma['mapImageMirrorState']['findUnique']>()
          .mockResolvedValue({ mirroredAt: new Date('2026-05-03T11:30:00Z') }),
        upsert: vi.fn<ThrottlePrisma['mapImageMirrorState']['upsert']>(),
        deleteMany: vi.fn<ThrottlePrisma['mapImageMirrorState']['deleteMany']>(),
      },
    } satisfies ThrottlePrisma

    await expect(isThrottled(prisma)).resolves.toBe(true)
  })

  it('returns false when the throttle row timestamp is in the future', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-03T12:00:00Z'))

    const prisma = {
      mapImageMirrorState: {
        findUnique: vi
          .fn<ThrottlePrisma['mapImageMirrorState']['findUnique']>()
          .mockResolvedValue({ mirroredAt: new Date('2026-05-03T12:30:00Z') }),
        upsert: vi.fn<ThrottlePrisma['mapImageMirrorState']['upsert']>(),
        deleteMany: vi.fn<ThrottlePrisma['mapImageMirrorState']['deleteMany']>(),
      },
    } satisfies ThrottlePrisma

    await expect(isThrottled(prisma)).resolves.toBe(false)
  })

  it('returns false when the throttle row is stale', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-03T12:00:00Z'))

    const prisma = {
      mapImageMirrorState: {
        findUnique: vi
          .fn<ThrottlePrisma['mapImageMirrorState']['findUnique']>()
          .mockResolvedValue({ mirroredAt: new Date('2026-05-03T10:00:00Z') }),
        upsert: vi.fn<ThrottlePrisma['mapImageMirrorState']['upsert']>(),
        deleteMany: vi.fn<ThrottlePrisma['mapImageMirrorState']['deleteMany']>(),
      },
    } satisfies ThrottlePrisma

    await expect(isThrottled(prisma)).resolves.toBe(false)
  })

  it('returns false when the throttle row is exactly one hour old', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-03T12:00:00Z'))

    const prisma = {
      mapImageMirrorState: {
        findUnique: vi
          .fn<ThrottlePrisma['mapImageMirrorState']['findUnique']>()
          .mockResolvedValue({ mirroredAt: new Date('2026-05-03T11:00:00Z') }),
        upsert: vi.fn<ThrottlePrisma['mapImageMirrorState']['upsert']>(),
        deleteMany: vi.fn<ThrottlePrisma['mapImageMirrorState']['deleteMany']>(),
      },
    } satisfies ThrottlePrisma

    await expect(isThrottled(prisma)).resolves.toBe(false)
  })

  it('writes the throttle row when recent timeouts reach the threshold', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-03T12:00:00Z'))

    const upsert = vi.fn<ThrottlePrisma['mapImageMirrorState']['upsert']>().mockResolvedValue({})
    const prisma = {
      mapImageMirrorState: {
        findUnique: vi.fn<ThrottlePrisma['mapImageMirrorState']['findUnique']>(),
        upsert,
        deleteMany: vi.fn<ThrottlePrisma['mapImageMirrorState']['deleteMany']>(),
      },
    } satisfies ThrottlePrisma

    await expect(recordTimeout(prisma, 10)).resolves.toBeUndefined()
    expect(upsert).toHaveBeenCalledWith({
      where: { sourceType_sourceId_variant: THROTTLE_KEY },
      create: {
        ...THROTTLE_KEY,
        canonicalUrl: 'throttle',
        r2Key: 'throttle',
        status: 'mirrored',
        mirroredAt: new Date('2026-05-03T12:00:00Z'),
      },
      update: {
        mirroredAt: new Date('2026-05-03T12:00:00Z'),
      },
    })
  })

  it('does not write the throttle row below the timeout threshold', async () => {
    const upsert = vi.fn<ThrottlePrisma['mapImageMirrorState']['upsert']>().mockResolvedValue({})
    const prisma = {
      mapImageMirrorState: {
        findUnique: vi.fn<ThrottlePrisma['mapImageMirrorState']['findUnique']>(),
        upsert,
        deleteMany: vi.fn<ThrottlePrisma['mapImageMirrorState']['deleteMany']>(),
      },
    } satisfies ThrottlePrisma

    await expect(recordTimeout(prisma, 9)).resolves.toBeUndefined()
    expect(upsert).not.toHaveBeenCalled()
  })

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'does not write the throttle row for invalid timeout count %p',
    async (recentTimeoutCount) => {
      const upsert = vi.fn<ThrottlePrisma['mapImageMirrorState']['upsert']>().mockResolvedValue({})
      const prisma = {
        mapImageMirrorState: {
          findUnique: vi.fn<ThrottlePrisma['mapImageMirrorState']['findUnique']>(),
          upsert,
          deleteMany: vi.fn<ThrottlePrisma['mapImageMirrorState']['deleteMany']>(),
        },
      } satisfies ThrottlePrisma

      await expect(recordTimeout(prisma, recentTimeoutCount)).resolves.toBeUndefined()
      expect(upsert).not.toHaveBeenCalled()
    },
  )

  it('treats missing throttle row as benign when clearing the breaker', async () => {
    const remove = vi
      .fn<ThrottlePrisma['mapImageMirrorState']['deleteMany']>()
      .mockResolvedValue({ count: 0 })
    const prisma = {
      mapImageMirrorState: {
        findUnique: vi.fn<ThrottlePrisma['mapImageMirrorState']['findUnique']>(),
        upsert: vi.fn<ThrottlePrisma['mapImageMirrorState']['upsert']>(),
        deleteMany: remove,
      },
    } satisfies ThrottlePrisma

    await expect(clearThrottle(prisma)).resolves.toBeUndefined()
    expect(remove).toHaveBeenCalledWith({
      where: { sourceType_sourceId_variant: THROTTLE_KEY },
    })
  })

  it('propagates persistence failures when clearing the breaker', async () => {
    const remove = vi
      .fn<ThrottlePrisma['mapImageMirrorState']['deleteMany']>()
      .mockRejectedValue(new Error('database offline'))
    const prisma = {
      mapImageMirrorState: {
        findUnique: vi.fn<ThrottlePrisma['mapImageMirrorState']['findUnique']>(),
        upsert: vi.fn<ThrottlePrisma['mapImageMirrorState']['upsert']>(),
        deleteMany: remove,
      },
    } satisfies ThrottlePrisma

    await expect(clearThrottle(prisma)).rejects.toThrow('database offline')
    expect(remove).toHaveBeenCalledWith({
      where: { sourceType_sourceId_variant: THROTTLE_KEY },
    })
  })
})
