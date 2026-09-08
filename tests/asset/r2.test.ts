import { afterEach, describe, expect, it, vi } from 'vitest'
import { InMemoryAssetRepo } from '@/lib/asset/repoMemory'
import { createGetAssetHandler, createPostAssetsHandler } from '@/lib/asset/handlers'
import { createAdminAssetsMigrateHandlers } from '@/lib/asset/adminMigrate'
import { variantKey } from '@/lib/asset/store'
import type { CfBindings } from '@/lib/anitabi/cf/bindings'

/**
 * 2026-09-08 图片资产迁 R2：读路径/上传归一化/存量迁移的 R2 行为测试。
 * 覆盖：变体命中 R2、未命中回落 bytes 并写回变体、并发闸门上限、
 * 无 storageKey 回落、R2 原图流式返回、SVG 加固保持、上传归一化、管理端迁移。
 */

const CF_CONTEXT_SYMBOL = Symbol.for('__cloudflare-context__')
type ImagesBindingFromContext = NonNullable<NonNullable<CfBindings['env']>['IMAGES']>
type AssetStoreBucketFromContext = NonNullable<NonNullable<CfBindings['env']>['ASSET_STORE']>

type FakeObject = { bytes: Uint8Array; contentType?: string }

function toStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    },
  })
}

async function toBytes(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    total += value.byteLength
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

function createFakeBucket() {
  const objects = new Map<string, FakeObject>()
  const bucket: AssetStoreBucketFromContext = {
    async get(key: string) {
      const object = objects.get(key)
      if (!object) return null
      return {
        body: toStream(object.bytes),
        size: object.bytes.byteLength,
        httpMetadata: object.contentType ? { contentType: object.contentType } : {},
      }
    },
    async put(key: string, value: ReadableStream<Uint8Array> | ArrayBuffer | ArrayBufferView, options) {
      const bytes = value instanceof ReadableStream
        ? await toBytes(value)
        : value instanceof ArrayBuffer
          ? new Uint8Array(value)
          : new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
      objects.set(key, {
        bytes,
        contentType: options?.httpMetadata?.contentType,
      })
    },
  }
  return { bucket, objects }
}

type FakeImagesOptions = {
  outputBytes?: Uint8Array
  failure?: Error
  onOutputStart?: () => void
  onOutputEnd?: () => void
  blockOutput?: () => Promise<void>
}

function createImagesBinding(options?: FakeImagesOptions) {
  const transforms: Array<{ width?: number; fit?: string }> = []
  let width = 0
  const binding = {
    input() {
      const transformer = {
        transform(transform: { width?: number; fit?: string }) {
          transforms.push(transform)
          width = transform.width ?? 0
          return transformer
        },
        async output() {
          options?.onOutputStart?.()
          if (options?.blockOutput) await options.blockOutput()
          options?.onOutputEnd?.()
          if (options?.failure) throw options.failure
          const body = options?.outputBytes ?? new Uint8Array(width === 1600 ? 4 : 2)
          return {
            response: () => new Response(body.buffer.slice(0) as ArrayBuffer),
          }
        },
      }
      return transformer
    },
  }
  return { binding: binding as unknown as ImagesBindingFromContext, transforms }
}

function installCfContext(env: Partial<NonNullable<CfBindings['env']>>) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, CF_CONTEXT_SYMBOL)
  Object.defineProperty(globalThis, CF_CONTEXT_SYMBOL, {
    configurable: true,
    value: { env } satisfies CfBindings,
  })
  return () => {
    if (previous) Object.defineProperty(globalThis, CF_CONTEXT_SYMBOL, previous)
    else delete (globalThis as Record<PropertyKey, unknown>)[CF_CONTEXT_SYMBOL]
  }
}

function installRuntimeCache() {
  const cache = { match: vi.fn().mockResolvedValue(null), put: vi.fn().mockResolvedValue(undefined) }
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'caches')
  Object.defineProperty(globalThis, 'caches', {
    configurable: true,
    value: { default: cache },
  })
  return {
    cache,
    restore: () => {
      if (previous) Object.defineProperty(globalThis, 'caches', previous)
      else delete (globalThis as Record<PropertyKey, unknown>).caches
    },
  }
}

function makeImageFile(bytes: Uint8Array, opts?: { name?: string; type?: string }) {
  return new File([bytes as unknown as BlobPart], opts?.name ?? 'image.png', { type: opts?.type ?? 'image/png' })
}

function getCtx(id: string) {
  return { params: Promise.resolve({ id }) }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('asset r2 read path', () => {
  it('variant hit in R2 streams back without touching the original or transform', async () => {
    const repo = new InMemoryAssetRepo()
    const asset = await repo.create({
      ownerId: 'user-1',
      contentType: 'image/jpeg',
      bytes: new Uint8Array([1, 2, 3, 4, 5]),
    })
    const { bucket, objects } = createFakeBucket()
    const variantBytes = new Uint8Array([9, 9, 9, 9])
    objects.set(variantKey(asset.id, 64, 72), { bytes: variantBytes, contentType: 'image/webp' })
    const { binding, transforms } = createImagesBinding({ failure: new Error('must not transform') })
    const restore = installCfContext({ ASSET_STORE: bucket, IMAGES: binding })
    const { cache, restore: restoreCache } = installRuntimeCache()
    const findBytes = vi.spyOn(repo, 'findBytesById')

    try {
      const get = createGetAssetHandler({ assetRepo: repo })
      const res = await get(new Request(`http://localhost/assets/${asset.id}?w=64&q=72`), getCtx(asset.id))
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toBe('image/webp')
      expect(res.headers.get('cache-control')).toContain('immutable')
      expect(Array.from(new Uint8Array(await res.arrayBuffer()))).toEqual(Array.from(variantBytes))
      expect(transforms).toEqual([])
      expect(findBytes).not.toHaveBeenCalled()
      expect(cache.put).toHaveBeenCalledTimes(1)
    } finally {
      restoreCache()
      restore()
    }
  })

  it('variant miss falls back to bytes, transforms, and writes the variant back to R2', async () => {
    const repo = new InMemoryAssetRepo()
    const original = new Uint8Array([1, 2, 3, 4, 5])
    const asset = await repo.create({
      ownerId: 'user-1',
      contentType: 'image/webp',
      bytes: original,
    })
    const { bucket, objects } = createFakeBucket()
    const normalized = new Uint8Array([7, 7, 7])
    const { binding, transforms } = createImagesBinding({ outputBytes: normalized })
    const restore = installCfContext({ ASSET_STORE: bucket, IMAGES: binding })

    try {
      const get = createGetAssetHandler({ assetRepo: repo })
      const res = await get(new Request(`http://localhost/assets/${asset.id}?w=64&q=72`), getCtx(asset.id))
      expect(res.status).toBe(200)
      expect(Array.from(new Uint8Array(await res.arrayBuffer()))).toEqual(Array.from(normalized))
      expect(transforms).toEqual([{ width: 64, fit: 'scale-down' }])
      // 无 ctx.waitUntil → putVariant 被同步 await，响应返回前变体已落 R2
      const stored = objects.get(variantKey(asset.id, 64, 72))
      expect(stored).toBeDefined()
      expect(stored?.contentType).toBe('image/webp')
      expect(Array.from(stored?.bytes ?? [])).toEqual(Array.from(normalized))

      // 第二次请求命中变体，不再触发转换
      const res2 = await get(new Request(`http://localhost/assets/${asset.id}?w=64&q=72`), getCtx(asset.id))
      expect(Array.from(new Uint8Array(await res2.arrayBuffer()))).toEqual(Array.from(normalized))
      expect(transforms).toHaveLength(1)
    } finally {
      restore()
    }
  })

  it('caps concurrent original-read-and-transform operations at 3 (module gate)', async () => {
    const repo = new InMemoryAssetRepo()
    const asset = await repo.create({
      ownerId: 'user-1',
      contentType: 'image/webp',
      bytes: new Uint8Array([1, 2, 3]),
    })
    const { bucket } = createFakeBucket()

    let inFlight = 0
    let maxInFlight = 0
    let started = 0
    let completed = 0
    const releaseQueue: Array<() => void> = []
    const { binding } = createImagesBinding({
      outputBytes: new Uint8Array([1]),
      onOutputStart: () => {
        started++
        inFlight++
        maxInFlight = Math.max(maxInFlight, inFlight)
      },
      onOutputEnd: () => {
        inFlight--
      },
      blockOutput: () => new Promise<void>((resolve) => releaseQueue.push(resolve)),
    })
    const restore = installCfContext({ ASSET_STORE: bucket, IMAGES: binding })

    try {
      const get = createGetAssetHandler({ assetRepo: repo })
      const requests = Array.from({ length: 6 }, (_, i) =>
        get(new Request(`http://localhost/assets/${asset.id}?w=${64 + i}&q=72`), getCtx(asset.id))
          .then((res) => {
            completed++
            return res
          }),
      )
      await new Promise((resolve) => setTimeout(resolve, 50))
      // 闸门生效：6 个并发只有 3 个进入转换，其余排队
      expect(started).toBe(3)
      expect(inFlight).toBe(3)

      // 逐个放行；腾出的闸门名额让排队请求进入（再放行），直到 6 个全部完成
      let guard = 0
      while (completed < 6 && guard < 500) {
        const release = releaseQueue.shift()
        if (release) release()
        else await new Promise((resolve) => setTimeout(resolve, 5))
        guard++
      }
      const responses = await Promise.all(requests)
      expect(responses.every((res) => res.status === 200)).toBe(true)
      expect(maxInFlight).toBeLessThanOrEqual(3)
      expect(inFlight).toBe(0)
    } finally {
      while (releaseQueue.length > 0) releaseQueue.shift()!()
      restore()
    }
  })

  it('serves the R2 original stream with its stored content-type when no variant and storageKey set', async () => {
    const repo = new InMemoryAssetRepo()
    const asset = await repo.create({
      ownerId: 'user-1',
      contentType: 'image/jpeg', // DB 里还是 jpeg（迁移不改 contentType）
      bytes: new Uint8Array([1, 2, 3]),
      storageKey: `originals/${'r2-original'}`,
    })
    const r2Bytes = new Uint8Array([5, 6, 7, 8])
    const { bucket, objects } = createFakeBucket()
    objects.set(asset.storageKey!, { bytes: r2Bytes, contentType: 'image/webp' }) // R2 里是归一化后的 webp
    const restore = installCfContext({ ASSET_STORE: bucket })
    const { cache, restore: restoreCache } = installRuntimeCache()
    const findBytes = vi.spyOn(repo, 'findBytesById')

    try {
      const get = createGetAssetHandler({ assetRepo: repo })
      const res = await get(new Request(`http://localhost/assets/${asset.id}`), getCtx(asset.id))
      expect(res.status).toBe(200)
      // 以 R2 对象的 httpMetadata 为准，避免 jpeg 字段配上 webp 字节
      expect(res.headers.get('content-type')).toBe('image/webp')
      expect(res.headers.get('cache-control')).toContain('immutable')
      expect(Array.from(new Uint8Array(await res.arrayBuffer()))).toEqual(Array.from(r2Bytes))
      expect(findBytes).not.toHaveBeenCalled()
      expect(cache.put).toHaveBeenCalledTimes(1)
    } finally {
      restoreCache()
      restore()
    }
  })

  it('falls back to bytes (no R2, no storageKey) with immutable caching for no-variant reads', async () => {
    const repo = new InMemoryAssetRepo()
    const bytes = new Uint8Array([11, 12, 13])
    const asset = await repo.create({ ownerId: 'user-1', contentType: 'image/webp', bytes })
    const restore = installCfContext({})

    try {
      const get = createGetAssetHandler({ assetRepo: repo })
      const res = await get(new Request(`http://localhost/assets/${asset.id}`), getCtx(asset.id))
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toBe('image/webp')
      expect(res.headers.get('cache-control')).toContain('immutable')
      expect(Array.from(new Uint8Array(await res.arrayBuffer()))).toEqual(Array.from(bytes))
    } finally {
      restore()
    }
  })

  it('still hardens migrated SVG assets (attachment + octet-stream) even with storageKey', async () => {
    const repo = new InMemoryAssetRepo()
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
    const asset = await repo.create({
      ownerId: 'user-1',
      contentType: 'image/svg+xml',
      filename: 'x.svg',
      bytes: svg,
      storageKey: 'originals/svg-asset',
    })
    const { bucket, objects } = createFakeBucket()
    objects.set('originals/svg-asset', { bytes: svg, contentType: 'image/svg+xml' })
    const restore = installCfContext({ ASSET_STORE: bucket })

    try {
      const get = createGetAssetHandler({ assetRepo: repo })
      const res = await get(new Request(`http://localhost/assets/${asset.id}`), getCtx(asset.id))
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toBe('application/octet-stream')
      expect(res.headers.get('content-disposition')).toContain('attachment')
      expect(Array.from(new Uint8Array(await res.arrayBuffer()))).toEqual(Array.from(svg))
    } finally {
      restore()
    }
  })
})

describe('asset r2 upload path', () => {
  it('normalizes non-gif uploads to 1600w webp, writes R2 original, and records storageKey/byteLength', async () => {
    const repo = new InMemoryAssetRepo()
    const { bucket, objects } = createFakeBucket()
    const normalized = new Uint8Array([8, 8, 8, 8])
    const { binding, transforms } = createImagesBinding({ outputBytes: normalized })
    const restore = installCfContext({ ASSET_STORE: bucket, IMAGES: binding })

    try {
      const post = createPostAssetsHandler({
        assetRepo: repo,
        getSession: async () => ({ user: { id: 'user-1' } }),
      })
      const form = new FormData()
      form.set('file', makeImageFile(new Uint8Array([1, 2, 3, 4, 5, 6])))
      const res = await post(new Request('http://localhost/api/assets', { method: 'POST', body: form }))
      expect(res.status).toBe(200)
      const { id } = (await res.json()) as { id: string }

      expect(transforms).toEqual([{ width: 1600, fit: 'scale-down' }])
      const stored = await repo.findById(id)
      expect(stored?.contentType).toBe('image/webp')
      expect(stored?.storageKey).toBe(`originals/${id}`)
      expect(stored?.byteLength).toBe(normalized.byteLength)
      // bytes 列仍写归一化后的字节（回滚到旧版本代码时读 bytes 一切照常）
      expect(Array.from((await repo.findBytesById(id)) ?? [])).toEqual(Array.from(normalized))

      const r2Object = objects.get(`originals/${id}`)
      expect(r2Object?.contentType).toBe('image/webp')
      expect(Array.from(r2Object?.bytes ?? [])).toEqual(Array.from(normalized))
    } finally {
      restore()
    }
  })

  it('stores gif uploads as-is without normalization', async () => {
    const repo = new InMemoryAssetRepo()
    const { bucket, objects } = createFakeBucket()
    const { binding, transforms } = createImagesBinding({ outputBytes: new Uint8Array([9]) })
    const restore = installCfContext({ ASSET_STORE: bucket, IMAGES: binding })

    try {
      const post = createPostAssetsHandler({
        assetRepo: repo,
        getSession: async () => ({ user: { id: 'user-1' } }),
      })
      const gif = new Uint8Array([1, 1, 1])
      const form = new FormData()
      form.set('file', makeImageFile(gif, { name: 'a.gif', type: 'image/gif' }))
      const res = await post(new Request('http://localhost/api/assets', { method: 'POST', body: form }))
      expect(res.status).toBe(200)
      const { id } = (await res.json()) as { id: string }

      expect(transforms).toEqual([])
      const stored = await repo.findById(id)
      expect(stored?.contentType).toBe('image/gif')
      expect(Array.from((await repo.findBytesById(id)) ?? [])).toEqual(Array.from(gif))
      const r2Object = objects.get(`originals/${id}`)
      expect(r2Object?.contentType).toBe('image/gif')
      expect(Array.from(r2Object?.bytes ?? [])).toEqual(Array.from(gif))
    } finally {
      restore()
    }
  })
})

describe('admin assets migrate', () => {
  const adminSession = async () => ({ user: { id: 'admin-1', isAdmin: true } })
  const anonSession = async () => null

  it('migrates assets serially: normalize non-gif, keep gif/bytes untouched, update only r2 fields', async () => {
    const repo = new InMemoryAssetRepo()
    const jpegBytes = new Uint8Array([1, 2, 3, 4])
    const gifBytes = new Uint8Array([5, 5])
    await repo.create({ id: 'asset-jpeg', ownerId: 'u', contentType: 'image/jpeg', bytes: jpegBytes })
    await repo.create({ id: 'asset-gif', ownerId: 'u', contentType: 'image/gif', bytes: gifBytes })
    const { bucket, objects } = createFakeBucket()
    const normalized = new Uint8Array([3, 3, 3])
    const { binding, transforms } = createImagesBinding({ outputBytes: normalized })
    const restore = installCfContext({ ASSET_STORE: bucket, IMAGES: binding })

    try {
      const handlers = createAdminAssetsMigrateHandlers({ assetRepo: repo, getSession: adminSession })
      const res = await handlers.POST(new Request('http://localhost/api/admin/assets/migrate?limit=10'))
      expect(res.status).toBe(200)
      const body = (await res.json()) as { migrated: number; remaining: number; failed: unknown[] }
      expect(body.migrated).toBe(2)
      expect(body.remaining).toBe(0)
      expect(body.failed).toEqual([])
      expect(transforms).toEqual([{ width: 1600, fit: 'scale-down' }])

      const jpeg = await repo.findById('asset-jpeg')
      expect(jpeg?.storageKey).toBe('originals/asset-jpeg')
      expect(jpeg?.byteLength).toBe(normalized.byteLength)
      expect(Array.from((await repo.findBytesById('asset-jpeg')) ?? [])).toEqual(Array.from(jpegBytes)) // bytes 列不动
      expect(objects.get('originals/asset-jpeg')?.contentType).toBe('image/webp')

      const gif = await repo.findById('asset-gif')
      expect(gif?.storageKey).toBe('originals/asset-gif')
      expect(gif?.byteLength).toBe(gifBytes.byteLength)
      expect(objects.get('originals/asset-gif')?.contentType).toBe('image/gif')

      const getRes = await handlers.GET()
      const stats = (await getRes.json()) as { total: number; migrated: number; remaining: number }
      expect(stats).toEqual({ total: 2, migrated: 2, remaining: 0 })
    } finally {
      restore()
    }
  })

  it('rejects non-admin (403) and reports 503 when the R2 binding is unavailable', async () => {
    const repo = new InMemoryAssetRepo()
    const restore = installCfContext({})

    try {
      const handlers = createAdminAssetsMigrateHandlers({ assetRepo: repo, getSession: anonSession })
      const forbidden = await handlers.POST(new Request('http://localhost/api/admin/assets/migrate'))
      expect(forbidden.status).toBe(403)
      const forbiddenGet = await handlers.GET()
      expect(forbiddenGet.status).toBe(403)

      const noStore = createAdminAssetsMigrateHandlers({ assetRepo: repo, getSession: adminSession })
      const res = await noStore.POST(new Request('http://localhost/api/admin/assets/migrate'))
      expect(res.status).toBe(503)
    } finally {
      restore()
    }
  })
})
