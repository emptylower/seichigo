const THROTTLE_KEY = { sourceType: '__throttle__', sourceId: 'global', variant: '__' } as const
const THROTTLE_DURATION_MS = 60 * 60 * 1000
const TIMEOUT_THRESHOLD = 10

type ThrottleWhere = {
  sourceType_sourceId_variant: typeof THROTTLE_KEY
}

type ThrottleRow = {
  mirroredAt: Date | null
}

type ThrottleCreateData = typeof THROTTLE_KEY & {
  canonicalUrl: string
  r2Key: string
  status: 'mirrored'
  mirroredAt: Date
}

export type ThrottlePrisma = {
  mapImageMirrorState: {
    findUnique(args: {
      where: ThrottleWhere
    }): Promise<ThrottleRow | null>
    upsert(args: {
      where: ThrottleWhere
      create: ThrottleCreateData
      update: {
        mirroredAt: Date
      }
    }): Promise<unknown>
    deleteMany(args: {
      where: ThrottleWhere
    }): Promise<{ count: number }>
  }
}

export async function isThrottled(prisma: ThrottlePrisma): Promise<boolean> {
  const row = await prisma.mapImageMirrorState.findUnique({
    where: {
      sourceType_sourceId_variant: THROTTLE_KEY,
    },
  })

  if (!row?.mirroredAt) {
    return false
  }

  const ageMs = Date.now() - row.mirroredAt.getTime()
  return ageMs >= 0 && ageMs < THROTTLE_DURATION_MS
}

export async function recordTimeout(
  prisma: ThrottlePrisma,
  recentTimeoutCount: number,
): Promise<void> {
  if (!Number.isFinite(recentTimeoutCount) || recentTimeoutCount < TIMEOUT_THRESHOLD) {
    return
  }

  const now = new Date()
  await prisma.mapImageMirrorState.upsert({
    where: {
      sourceType_sourceId_variant: THROTTLE_KEY,
    },
    create: {
      ...THROTTLE_KEY,
      canonicalUrl: 'throttle',
      r2Key: 'throttle',
      status: 'mirrored',
      mirroredAt: now,
    },
    update: {
      mirroredAt: now,
    },
  })
}

export async function clearThrottle(prisma: ThrottlePrisma): Promise<void> {
  await prisma.mapImageMirrorState.deleteMany({
    where: {
      sourceType_sourceId_variant: THROTTLE_KEY,
    },
  })
}
