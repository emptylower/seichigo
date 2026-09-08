import { describe, expect, it } from 'vitest'
import { MemoryShareLinkRepo } from '@/lib/share/repoMemory'
import { createGetCheckinPhotoHandler, createGetShareImageHandler } from '@/lib/share/handlers/media'
import type { ShareStore } from '@/lib/share/store'

function makeStore() {
  const objects = new Map<string, { bytes: Uint8Array; contentType: string }>()
  const store: ShareStore = {
    async put(key, bytes, contentType) {
      objects.set(key, { bytes, contentType })
    },
    async get(key) {
      const found = objects.get(key)
      if (!found) return null
      return {
        body: new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(found.bytes)
            c.close()
          },
        }),
        contentType: found.contentType,
        size: found.bytes.byteLength,
      }
    },
  }
  return { store, objects }
}

const req = new Request('https://seichigo.com/api/share/img/AbC12xYz')

describe('GET /api/share/img/[code]', () => {
  it('命中时带一年不可变缓存', async () => {
    const repo = new MemoryShareLinkRepo()
    await repo.create({
      code: 'AbC12xYz',
      pointId: '101:station',
      bangumiId: 101,
      locale: 'zh',
      layout: 'portrait',
      userId: 'u1',
      ipHash: null,
    })
    await repo.markUploaded('AbC12xYz', { imageKey: 'share/AbC12xYz.jpg', userId: 'u1' })
    const { store, objects } = makeStore()
    objects.set('share/AbC12xYz.jpg', { bytes: Uint8Array.from([1, 2]), contentType: 'image/jpeg' })

    const res = await createGetShareImageHandler({ repo, getStore: () => store })(req, {
      params: Promise.resolve({ code: 'AbC12xYz' }),
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/jpeg')
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
  })

  it('短码非法、记录缺失、imageKey 为空、对象缺失都 404', async () => {
    const repo = new MemoryShareLinkRepo()
    const { store } = makeStore()
    const handler = createGetShareImageHandler({ repo, getStore: () => store })
    expect((await handler(req, { params: Promise.resolve({ code: 'bad' }) })).status).toBe(404)
    expect((await handler(req, { params: Promise.resolve({ code: 'ZZZZZZZZ' }) })).status).toBe(404)
    await repo.create({
      code: 'AbC12xYz',
      pointId: 'p',
      bangumiId: 1,
      locale: 'zh',
      layout: 'portrait',
      userId: null,
      ipHash: null,
    })
    expect((await handler(req, { params: Promise.resolve({ code: 'AbC12xYz' }) })).status).toBe(404)
  })
})

describe('GET /api/share/photo/[userId]/[pointId]', () => {
  it('按 checkin key 读回', async () => {
    const { store, objects } = makeStore()
    objects.set('checkin/u1/101:station.jpg', {
      bytes: Uint8Array.from([9]),
      contentType: 'image/jpeg',
    })
    const res = await createGetCheckinPhotoHandler({ getStore: () => store })(req, {
      params: Promise.resolve({ userId: 'u1', pointId: '101:station' }),
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
  })

  it('路径穿越被挡下', async () => {
    const { store } = makeStore()
    const res = await createGetCheckinPhotoHandler({ getStore: () => store })(req, {
      params: Promise.resolve({ userId: '../u1', pointId: 'p' }),
    })
    expect(res.status).toBe(404)
  })
})
