import { describe, expect, it, vi } from 'vitest'
import { InMemoryAssetRepo } from '@/lib/asset/repoMemory'
import { createGetAssetHandler, createPostAssetsHandler, createPostAssetsHandlerWithOwner } from '@/lib/asset/handlers'
import type { CfBindings } from '@/lib/anitabi/cf/bindings'
import sharp from 'sharp'

const CF_CONTEXT_SYMBOL = Symbol.for('__cloudflare-context__')
type ImagesBindingFromContext = NonNullable<NonNullable<CfBindings['env']>['IMAGES']>

function installCfImagesBinding(images: ImagesBindingFromContext) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, CF_CONTEXT_SYMBOL)
  Object.defineProperty(globalThis, CF_CONTEXT_SYMBOL, {
    configurable: true,
    value: { env: { IMAGES: images } } satisfies CfBindings,
  })
  return () => {
    if (previous) Object.defineProperty(globalThis, CF_CONTEXT_SYMBOL, previous)
    else delete (globalThis as Record<PropertyKey, unknown>)[CF_CONTEXT_SYMBOL]
  }
}

function installRuntimeCache(cache: unknown) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'caches')
  Object.defineProperty(globalThis, 'caches', {
    configurable: true,
    value: { default: cache },
  })
  return () => {
    if (previous) Object.defineProperty(globalThis, 'caches', previous)
    else delete (globalThis as Record<PropertyKey, unknown>).caches
  }
}

function createImagesBinding(options?: { failure?: Error }) {
  const transforms: Array<{ width?: number; fit?: string }> = []
  const binding = {
    input() {
      let width = 0
      const transformer = {
        transform(transform: { width?: number; fit?: string }) {
          transforms.push(transform)
          width = transform.width ?? 0
          return transformer
        },
        async output() {
          if (options?.failure) throw options.failure
          const body = new Uint8Array(width === 64 ? 16 : 64)
          return {
            response: () => new Response(body.buffer.slice(0)),
            contentType: () => 'image/webp',
            image: () => new Blob([body]).stream(),
          }
        },
      }
      return transformer
    },
  }
  return { binding: binding as unknown as ImagesBindingFromContext, transforms }
}

function makeImageFile(bytes: Uint8Array, opts?: { name?: string; type?: string }) {
  return new File([bytes as unknown as BlobPart], opts?.name ?? 'image.png', { type: opts?.type ?? 'image/png' })
}

describe('asset api', () => {
  it('rejects upload when unauthenticated (401)', async () => {
    const repo = new InMemoryAssetRepo()
    const post = createPostAssetsHandler({
      assetRepo: repo,
      getSession: async () => null,
    })

    const bytes = new Uint8Array([1, 2, 3])
    const form = new FormData()
    form.set('file', makeImageFile(bytes))

    const res = await post(new Request('http://localhost/api/assets', { method: 'POST', body: form }))
    expect(res.status).toBe(401)
  })

  it('uploads image and returns {id,url}; stores bytes/contentType', async () => {
    const repo = new InMemoryAssetRepo()
    const post = createPostAssetsHandler({
      assetRepo: repo,
      getSession: async () => ({ user: { id: 'user-1' } }),
    })

    const bytes = new Uint8Array([7, 8, 9, 10])
    const form = new FormData()
    form.set('file', makeImageFile(bytes, { name: 'a.png', type: 'image/png' }))

    const res = await post(new Request('http://localhost/api/assets', { method: 'POST', body: form }))
    expect(res.status).toBe(200)
    const json = (await res.json()) as { id: string; url: string }

    expect(typeof json.id).toBe('string')
    expect(json.id.length).toBeGreaterThan(0)
    expect(json.url).toBe(`/assets/${json.id}`)

    const stored = await repo.findById(json.id)
    expect(stored).not.toBeNull()
    expect(stored?.contentType).toBe('image/png')
    expect(Array.from((await repo.findBytesById(json.id)) ?? [])).toEqual(Array.from(bytes))
  })

  it('uploads image with custom owner resolver', async () => {
    const repo = new InMemoryAssetRepo()
    const post = createPostAssetsHandlerWithOwner({
      assetRepo: repo,
      resolveOwnerId: async () => ({ ok: true, ownerId: 'owner-from-token' }),
    })

    const bytes = new Uint8Array([7, 8, 9])
    const form = new FormData()
    form.set('file', makeImageFile(bytes, { name: 'a.png', type: 'image/png' }))

    const res = await post(new Request('http://localhost/api/ai/assets', { method: 'POST', body: form }))
    expect(res.status).toBe(200)
    const json = (await res.json()) as { id: string; url: string }
    const stored = await repo.findById(json.id)
    expect(stored?.ownerId).toBe('owner-from-token')
  })

  it('returns custom resolver error response when owner cannot be resolved', async () => {
    const repo = new InMemoryAssetRepo()
    const post = createPostAssetsHandlerWithOwner({
      assetRepo: repo,
      resolveOwnerId: async () => ({ ok: false, response: new Response(JSON.stringify({ error: '无权限' }), { status: 403 }) }),
    })

    const bytes = new Uint8Array([7, 8, 9])
    const form = new FormData()
    form.set('file', makeImageFile(bytes, { name: 'a.png', type: 'image/png' }))

    const res = await post(new Request('http://localhost/api/ai/assets', { method: 'POST', body: form }))
    expect(res.status).toBe(403)
  })

  it('serves uploaded asset publicly with correct Content-Type and bytes', async () => {
    const repo = new InMemoryAssetRepo()
    const post = createPostAssetsHandler({
      assetRepo: repo,
      getSession: async () => ({ user: { id: 'user-1' } }),
    })
    const get = createGetAssetHandler({ assetRepo: repo })

    const bytes = new Uint8Array([11, 12, 13])
    const form = new FormData()
    form.set('file', makeImageFile(bytes, { type: 'image/webp', name: 'b.webp' }))

    const uploadRes = await post(new Request('http://localhost/api/assets', { method: 'POST', body: form }))
    const { id } = (await uploadRes.json()) as { id: string; url: string }

    const res = await get(new Request(`http://localhost/assets/${id}`), { params: Promise.resolve({ id }) })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/webp')
    const out = new Uint8Array(await res.arrayBuffer())
    expect(Array.from(out)).toEqual(Array.from(bytes))
  })

  it('serves a resized WebP variant when w query param is provided', async () => {
    const repo = new InMemoryAssetRepo()
    const post = createPostAssetsHandler({
      assetRepo: repo,
      getSession: async () => ({ user: { id: 'user-1' } }),
    })
    const get = createGetAssetHandler({ assetRepo: repo })

    const png = await sharp({
      create: {
        width: 120,
        height: 80,
        channels: 3,
        background: { r: 255, g: 0, b: 0 },
      },
    })
      .png()
      .toBuffer()

    const form = new FormData()
    form.set('file', new File([png as unknown as BlobPart], 'a.png', { type: 'image/png' }))
    const uploadRes = await post(new Request('http://localhost/api/assets', { method: 'POST', body: form }))
    const { id } = (await uploadRes.json()) as { id: string; url: string }

    const res = await get(new Request(`http://localhost/assets/${id}?w=50&q=60`), { params: Promise.resolve({ id }) })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/webp')
    expect(res.headers.get('cache-control')).toContain('immutable')

    const out = Buffer.from(await res.arrayBuffer())
    const meta = await sharp(out).metadata()
    expect(typeof meta.width).toBe('number')
    expect(meta.width as number).toBeLessThanOrEqual(50)
  })

  it('uses the Cloudflare Images binding for distinct responsive variants', async () => {
    const repo = new InMemoryAssetRepo({ idFactory: () => 'responsive-image' })
    await repo.create({
      ownerId: 'user-1',
      contentType: 'image/webp',
      filename: 'responsive.webp',
      bytes: new Uint8Array([1, 2, 3]),
    })
    const { binding, transforms } = createImagesBinding()
    const restoreBinding = installCfImagesBinding(binding)

    try {
      const get = createGetAssetHandler({ assetRepo: repo })
      const small = await get(new Request('http://localhost/assets/responsive-image?w=64&q=72'), {
        params: Promise.resolve({ id: 'responsive-image' }),
      })
      const large = await get(new Request('http://localhost/assets/responsive-image?w=1200&q=72'), {
        params: Promise.resolve({ id: 'responsive-image' }),
      })

      expect((await small.arrayBuffer()).byteLength).toBe(16)
      expect((await large.arrayBuffer()).byteLength).toBe(64)
      expect(transforms).toEqual([
        { width: 64, fit: 'scale-down' },
        { width: 1200, fit: 'scale-down' },
      ])
    } finally {
      restoreBinding()
    }
  })

  it('returns a transform failure as no-store and does not cache it', async () => {
    const repo = new InMemoryAssetRepo({ idFactory: () => 'broken-image' })
    const original = new Uint8Array([4, 5, 6])
    await repo.create({
      ownerId: 'user-1',
      contentType: 'image/webp',
      filename: 'broken.webp',
      bytes: original,
    })
    const { binding } = createImagesBinding({ failure: new Error('transform unavailable') })
    const restoreBinding = installCfImagesBinding(binding)
    const cache = { match: vi.fn().mockResolvedValue(null), put: vi.fn() }
    const restoreCache = installRuntimeCache(cache)
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    try {
      const get = createGetAssetHandler({ assetRepo: repo })
      const response = await get(new Request('http://localhost/assets/broken-image?w=64&q=72'), {
        params: Promise.resolve({ id: 'broken-image' }),
      })

      expect(response.status).toBe(200)
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual(Array.from(original))
      expect(cache.put).not.toHaveBeenCalled()
      expect(log).toHaveBeenCalledWith(
        '[asset.variant.transform_failed]',
        expect.objectContaining({
          event: 'asset_image_variant_transform_failed',
          assetId: 'broken-image',
          width: 64,
          quality: 72,
        })
      )
    } finally {
      log.mockRestore()
      restoreCache()
      restoreBinding()
    }
  })

  it('returns a runtime cache hit before reading the asset repository', async () => {
    const repo = new InMemoryAssetRepo()
    const findById = vi.spyOn(repo, 'findById')
    const cached = new Response(new Uint8Array([9]).buffer, {
      headers: { 'content-type': 'image/webp', 'cache-control': 'public, max-age=31536000, immutable' },
    })
    const cache = { match: vi.fn().mockResolvedValue(cached), put: vi.fn() }
    const restoreCache = installRuntimeCache(cache)

    try {
      const get = createGetAssetHandler({ assetRepo: repo })
      const response = await get(new Request('http://localhost/assets/cached-image?w=64&q=72'), {
        params: Promise.resolve({ id: 'cached-image' }),
      })

      expect(response.status).toBe(200)
      expect(cache.match).toHaveBeenCalledWith('http://localhost/assets/cached-image?w=64&q=72')
      expect(findById).not.toHaveBeenCalled()
    } finally {
      restoreCache()
    }
  })

  it('rejects files larger than ASSET_MAX_BYTES (413)', async () => {
    const prev = process.env.ASSET_MAX_BYTES
    process.env.ASSET_MAX_BYTES = '2'
    try {
      const repo = new InMemoryAssetRepo()
      const post = createPostAssetsHandler({
        assetRepo: repo,
        getSession: async () => ({ user: { id: 'user-1' } }),
      })

      const bytes = new Uint8Array([1, 2, 3])
      const form = new FormData()
      form.set('file', makeImageFile(bytes))

      const res = await post(new Request('http://localhost/api/assets', { method: 'POST', body: form }))
      expect(res.status).toBe(413)
    } finally {
      if (prev === undefined) delete process.env.ASSET_MAX_BYTES
      else process.env.ASSET_MAX_BYTES = prev
    }
  })

  it('rejects SVG uploads (415)', async () => {
    const repo = new InMemoryAssetRepo()
    const post = createPostAssetsHandler({
      assetRepo: repo,
      getSession: async () => ({ user: { id: 'user-1' } }),
    })

    const bytes = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>')
    const form = new FormData()
    form.set('file', makeImageFile(bytes, { name: 'x.svg', type: 'image/svg+xml' }))

    const res = await post(new Request('http://localhost/api/assets', { method: 'POST', body: form }))
    expect(res.status).toBe(415)
  })

  it('serves legacy SVG assets as downloads (octet-stream + attachment)', async () => {
    const repo = new InMemoryAssetRepo()
    const get = createGetAssetHandler({ assetRepo: repo })

    const bytes = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
    const created = await repo.create({
      ownerId: 'user-1',
      contentType: 'image/svg+xml',
      filename: 'x.svg',
      bytes,
    })

    const res = await get(new Request(`http://localhost/assets/${created.id}`), { params: Promise.resolve({ id: created.id }) })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/octet-stream')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('content-disposition')).toContain('attachment')
    const out = new Uint8Array(await res.arrayBuffer())
    expect(Array.from(out)).toEqual(Array.from(bytes))
  })
})
