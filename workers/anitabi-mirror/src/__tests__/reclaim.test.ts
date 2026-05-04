import { describe, expect, it, vi } from 'vitest'

import type { ReclaimPrisma } from '../reclaim'
import { reclaimStale } from '../reclaim'

describe('reclaimStale', () => {
  it('reclaims stale in-progress rows back to pending', async () => {
    vi.useFakeTimers()

    try {
      vi.setSystemTime(new Date('2026-05-03T12:00:00Z'))

      const updateMany = vi
        .fn<ReclaimPrisma['mapImageMirrorState']['updateMany']>()
        .mockResolvedValue({ count: 3 })
      const prisma = {
        mapImageMirrorState: {
          updateMany,
        },
      } satisfies ReclaimPrisma

      await expect(reclaimStale(prisma)).resolves.toEqual({ count: 3 })
      expect(updateMany).toHaveBeenCalledWith({
        where: {
          status: 'in_progress',
          lastAttemptAt: { lt: new Date('2026-05-03T11:55:00Z') },
        },
        data: { status: 'pending' },
      })
    } finally {
      vi.useRealTimers()
      vi.restoreAllMocks()
    }
  })
})
