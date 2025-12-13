import { describe, expect, it } from 'vitest'
import { InMemoryAssetRepo } from '@/lib/asset/repoMemory'
import { createGetAssetHandler, createPostAssetsHandler } from '@/lib/asset/handlers'

function makeImageFile(bytes: Uint8Array, opts?: { name?: string; type?: string }) {
  return new File([bytes], opts?.name ?? 'image.png', { type: opts?.type ?? 'image/png' })
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
    expect(Array.from(stored?.bytes ?? [])).toEqual(Array.from(bytes))
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
})

