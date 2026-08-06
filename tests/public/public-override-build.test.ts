import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

describe('public override lookup failures', () => {
  const originalNextPhase = process.env.NEXT_PHASE
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.resetModules()
    prismaMocks.findMany.mockReset()
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    if (originalNextPhase === undefined) {
      delete process.env.NEXT_PHASE
    } else {
      process.env.NEXT_PHASE = originalNextPhase
    }
  })

  afterEach(() => {
    errorSpy.mockRestore()
    if (originalNextPhase === undefined) {
      delete process.env.NEXT_PHASE
    } else {
      process.env.NEXT_PHASE = originalNextPhase
    }
  })

  it.each([
    ['runtime', undefined],
    ['production build', 'phase-production-build'],
  ] as const)('propagates prisma failures during %s', async (_label, nextPhase) => {
    if (nextPhase) process.env.NEXT_PHASE = nextPhase
    else delete process.env.NEXT_PHASE
    const reason = new Error(`public override unavailable during ${_label}`)
    prismaMocks.findMany.mockRejectedValue(reason)

    const { resolvePublicOverrideForPost } = await import('@/lib/publicOverride/service')

    await expect(resolvePublicOverrideForPost(`test-post-${_label}`, 'zh')).rejects.toBe(reason)
    expect(prismaMocks.findMany).toHaveBeenCalledOnce()
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringMatching(/^\[degraded:override\.lookup\]/),
      expect.objectContaining({
        targetType: 'post',
        targetKeys: expect.arrayContaining([expect.stringMatching(/^test-post-/)]),
        locales: ['zh', null],
      }),
      reason
    )
  })

  it('logs every lookup failure in a module instance', async () => {
    const reason = new Error('public override unavailable')
    prismaMocks.findMany.mockRejectedValue(reason)
    const { resolvePublicOverrideForPost } = await import('@/lib/publicOverride/service')

    await expect(resolvePublicOverrideForPost('first-post', 'zh')).rejects.toBe(reason)
    await expect(resolvePublicOverrideForPost('second-post', 'zh')).rejects.toBe(reason)

    expect(prismaMocks.findMany).toHaveBeenCalledTimes(2)
    expect(errorSpy).toHaveBeenCalledTimes(2)
    expect(errorSpy.mock.calls.map((call) => call[0])).toEqual([
      '[degraded:override.lookup]',
      '[degraded:override.lookup]',
    ])
    expect(errorSpy.mock.calls.map((call) => call[2])).toEqual([reason, reason])
  })
})
