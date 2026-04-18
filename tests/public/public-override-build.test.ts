import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMocks = vi.hoisted(() => ({
  findMany: vi.fn(),
}))

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    publicOverride: {
      findMany: (...args: any[]) => prismaMocks.findMany(...args),
    },
  },
}))

describe('public override build-time bypass', () => {
  const originalNextPhase = process.env.NEXT_PHASE

  beforeEach(() => {
    vi.resetModules()
    prismaMocks.findMany.mockReset()
    if (originalNextPhase === undefined) {
      delete process.env.NEXT_PHASE
    } else {
      process.env.NEXT_PHASE = originalNextPhase
    }
  })

  it('returns null without querying prisma during production build phase', async () => {
    process.env.NEXT_PHASE = 'phase-production-build'
    prismaMocks.findMany.mockRejectedValue(new Error('should not query prisma during build'))

    const { resolvePublicOverrideForPost } = await import('@/lib/publicOverride/service')
    const result = await resolvePublicOverrideForPost('test-post', 'zh')

    expect(result).toBeNull()
    expect(prismaMocks.findMany).not.toHaveBeenCalled()
  })
})
