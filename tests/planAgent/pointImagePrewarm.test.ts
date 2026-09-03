import { afterEach, describe, expect, it, vi } from 'vitest'
import { dispatchPointImagePrewarm, prewarmPointImages } from '@/lib/planAgent/pointImagePrewarm'
import type { PointImagePrewarmPrisma, PointImagePrewarmUpsertArgs, PrewarmPointRef } from '@/lib/planAgent/pointImagePrewarm'
import { enrichAndNormalizeDays } from '@/lib/planAgent/enrichPipeline'
import { computeMirrorKey } from '@/lib/anitabi/imageNormalize'
import type { R2MirrorBucket } from '@/lib/anitabi/r2Mirror'
import type { EnrichContext } from '@/lib/planAgent/enrich/types'

/**
 * 第六轮 C：保存即预热。save_plan_days / 补齐续跑共用的 enrichPipeline 在
 * enrichAndNormalizeDays 之后后台预热点位图的两个镜像变体（h160 + w640q80）：
 * R2 已命中的不 fetch，未命中的 fetch 投递域 → put R2 → upsert mirrored 状态。
 * 第六轮 E3d：入参改为 { pointId, imageUrl } 对，MapImageMirrorState.sourceId
 * 用点位 id（与 cron 侧同键，每个点位只有一套状态行）。
 */

const IMG1 = 'https://image.anitabi.cn/points/prewarm-a.jpg'
const IMG2 = 'https://image.anitabi.cn/points/prewarm-b.jpg'
const IMG3 = 'https://image.anitabi.cn/user/0/bangumi/899/points/prewarm-c.jpg'

function imageResponse(): Response {
  return new Response(new Uint8Array([1, 2, 3]), {
    status: 200,
    headers: { 'content-type': 'image/jpeg' },
  })
}

/** 与实现同口径：按 URL 扩展名推断 mime 后计算的镜像 key */
async function variantKeys(url: string): Promise<string[]> {
  const { enumeratePointImageVariants } = await import('@/lib/anitabi/imageMirrorVariants')
  const variants = enumeratePointImageVariants(url)
  return Promise.all(variants.map((variant) => computeMirrorKey(variant.url, 'image/jpeg')))
}

function makeBucket(hitKeys: Set<string>): R2MirrorBucket {
  return {
    head: vi.fn(async () => null),
    get: vi.fn(async (key: string) =>
      hitKeys.has(key)
        ? {
            customMetadata: {
              originalUrl: 'https://image.anitabi.cn/points/prewarm-hit.jpg',
              mimeType: 'image/jpeg',
              mirroredAt: new Date().toISOString(),
              mirrorSource: 'cron-seed',
              contentLength: '3',
            },
            httpMetadata: { contentType: 'image/jpeg' },
            size: 3,
            arrayBuffer: async () => new Uint8Array([9]).buffer,
          }
        : null,
    ),
    put: vi.fn(async () => undefined),
  }
}

function makePrisma() {
  const upsert = vi.fn(async (_args: PointImagePrewarmUpsertArgs) => ({}))
  const prisma: PointImagePrewarmPrisma = { mapImageMirrorState: { upsert } }
  return { prisma, upsert }
}

function refs(...entries: Array<[string, string]>): PrewarmPointRef[] {
  return entries.map(([pointId, imageUrl]) => ({ pointId, imageUrl }))
}

describe('prewarmPointImages', () => {
  it('3 个点位图 → 6 次 get、其中 2 次命中不 fetch、4 次 fetch+put（fetch 走投递域，sourceId=点位 id）', async () => {
    const hitKeys = new Set(await variantKeys(IMG1))
    const bucket = makeBucket(hitKeys)
    const { prisma, upsert } = makePrisma()
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => imageResponse())

    const result = await prewarmPointImages({
      points: refs(['pt-a', IMG1], ['pt-b', IMG2], ['pt-c', IMG3]),
      bucket,
      prisma,
      fetchImpl,
    })

    expect(bucket.get).toHaveBeenCalledTimes(6)
    expect(fetchImpl).toHaveBeenCalledTimes(4)
    expect(bucket.put).toHaveBeenCalledTimes(4)
    expect(upsert).toHaveBeenCalledTimes(4)
    expect(result).toEqual({ considered: 6, hit: 2, mirrored: 4, failed: 0 })
    for (const call of fetchImpl.mock.calls) {
      const url = String(call[0])
      expect(url.startsWith('https://img-tc.anitabi.cn/')).toBe(true)
      expect(url).toContain('prewarm-')
    }
    const seenSourceIds = new Set<string>()
    for (const [args] of upsert.mock.calls) {
      expect(args.where.sourceType_sourceId_variant.sourceType).toBe('point-image')
      expect(args.create.status).toBe('mirrored')
      expect(args.create.canonicalUrl).toContain('image.anitabi.cn')
      seenSourceIds.add(args.where.sourceType_sourceId_variant.sourceId)
    }
    // 状态行 sourceId 是点位 id（与 cron 侧同键），不再是 pathname；
    // pt-a 两变体 R2 命中不产生 upsert
    expect(seenSourceIds).toEqual(new Set(['pt-b', 'pt-c']))
  })

  it('超过 maxImages 截断：5 张只处理前 2 张（4 个变体）', async () => {
    const bucket = makeBucket(new Set())
    const { prisma } = makePrisma()
    const fetchImpl = vi.fn(async () => imageResponse())
    const points = [1, 2, 3, 4, 5].map((i) => ({ pointId: `pt-${i}`, imageUrl: `https://image.anitabi.cn/points/trunc-${i}.jpg` }))

    const result = await prewarmPointImages({ points, bucket, prisma, fetchImpl, maxImages: 2 })

    expect(bucket.get).toHaveBeenCalledTimes(4)
    expect(fetchImpl).toHaveBeenCalledTimes(4)
    expect(bucket.put).toHaveBeenCalledTimes(4)
    expect(result).toEqual({ considered: 4, hit: 0, mirrored: 4, failed: 0 })
  })

  it('上游失败只 warn 不抛出：计 failed、不 put、不 upsert', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const bucket = makeBucket(new Set())
    const { prisma, upsert } = makePrisma()
    const fetchImpl = vi.fn(async () => new Response('forbidden', { status: 403 }))

    const result = await prewarmPointImages({ points: refs(['pt-b', IMG2]), bucket, prisma, fetchImpl })

    expect(result).toEqual({ considered: 2, hit: 0, mirrored: 0, failed: 2 })
    expect(bucket.put).not.toHaveBeenCalled()
    expect(upsert).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('重复 pointId 与非 anitabi 点位图被去重/忽略', async () => {
    const bucket = makeBucket(new Set())
    const { prisma } = makePrisma()
    const fetchImpl = vi.fn(async () => imageResponse())

    const result = await prewarmPointImages({
      points: [
        ...refs(['pt-b', IMG2]),
        ...refs(['pt-b', IMG2]),
        ...refs(['pt-other', 'https://example.com/not-anitabi.jpg']),
        ...refs(['pt-cover', 'https://image.anitabi.cn/bangumi/1/cover.jpg']),
      ],
      bucket,
      prisma,
      fetchImpl,
    })

    expect(result).toEqual({ considered: 2, hit: 0, mirrored: 2, failed: 0 })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
})

describe('接线：enrichAndNormalizeDays 保存即预热', () => {
  const CLOUDFLARE_CONTEXT_SYMBOL = Symbol.for('__cloudflare-context__')

  afterEach(() => {
    delete (globalThis as typeof globalThis & Record<symbol, unknown>)[CLOUDFLARE_CONTEXT_SYMBOL]
  })

  function makeCtx(image: string | undefined): EnrichContext {
    return {
      deps: {},
      coordsByPointId: new Map([['1:1', { lat: 34.88, lng: 135.8, ...(image ? { image } : {}) }]]),
    }
  }

  it('有 bucket 时经 ctx.waitUntil 派发预热（R2 get + 投递域 fetch + put）', async () => {
    const bucket = makeBucket(new Set())
    const waitUntil = vi.fn()
    ;(globalThis as typeof globalThis & Record<symbol, unknown>)[CLOUDFLARE_CONTEXT_SYMBOL] = {
      env: { MAP_IMAGE_CACHE: bucket },
      ctx: { waitUntil },
    }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    // 无注入通道时预热用全局 fetch——桩掉避免真实外呼
    const fetchImpl = vi.fn(async () => imageResponse())
    vi.stubGlobal('fetch', fetchImpl)

    try {
      await enrichAndNormalizeDays([], makeCtx(IMG2))

      expect(waitUntil).toHaveBeenCalledTimes(1)
      await Promise.all(waitUntil.mock.calls.map(([promise]) => promise as Promise<unknown>))
      expect(bucket.get).toHaveBeenCalledTimes(2)
      expect(fetchImpl).toHaveBeenCalledTimes(2)
      expect(bucket.put).toHaveBeenCalledTimes(2)
    } finally {
      vi.unstubAllGlobals()
      warn.mockRestore()
    }
  })

  it('无 bucket（本地）直接跳过，不派发任何后台任务', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await enrichAndNormalizeDays([], makeCtx(IMG2))

    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('dispatchPointImagePrewarm 可注入 prisma/fetch 假件走完整链路并 upsert mirrored（sourceId=点位 id）', async () => {
    const bucket = makeBucket(new Set())
    const waitUntil = vi.fn()
    ;(globalThis as typeof globalThis & Record<symbol, unknown>)[CLOUDFLARE_CONTEXT_SYMBOL] = {
      env: { MAP_IMAGE_CACHE: bucket },
      ctx: { waitUntil },
    }
    const { prisma, upsert } = makePrisma()
    const fetchImpl = vi.fn(async () => imageResponse())

    dispatchPointImagePrewarm(refs(['899:c', IMG3]), { prisma, fetchImpl })
    expect(waitUntil).toHaveBeenCalledTimes(1)
    await Promise.all(waitUntil.mock.calls.map(([promise]) => promise as Promise<unknown>))

    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(upsert).toHaveBeenCalledTimes(2)
    for (const [args] of upsert.mock.calls) {
      expect(args.create.status).toBe('mirrored')
      expect(args.where.sourceType_sourceId_variant.sourceId).toBe('899:c')
    }
  })
})
