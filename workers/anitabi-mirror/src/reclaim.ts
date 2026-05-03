import type { PrismaClient } from '@prisma/client'

const STALE_THRESHOLD_MS = 5 * 60 * 1000

export async function reclaimStale(prisma: PrismaClient): Promise<{ count: number }> {
  const cutoff = new Date(Date.now() - STALE_THRESHOLD_MS)
  const result = await prisma.mapImageMirrorState.updateMany({
    where: {
      status: 'in_progress',
      lastAttemptAt: { lt: cutoff },
    },
    data: { status: 'pending' },
  })

  return { count: result.count }
}
