import { describe, it, expect, vi, type Mock } from 'vitest'
import type { Session } from 'next-auth'
import { createPlacePhotoHandlers } from '@/lib/googlePlaces/handlers/placePhoto'
import { buildPhotoRefCanonicalUrl as buildPhotoCanonicalUrl, buildPlacePhotoCanonicalUrl } from '@/lib/googlePlaces/photoFetch'
import { createMemoryExternalPlaceStore } from '@/lib/googlePlaces/storeMemory'
import type { ExternalPlaceStore } from '@/lib/googlePlaces/store'
import type { ResolvedPlace } from '@/lib/googlePlaces/places'
import type { R2MirrorBucket } from '@/lib/anitabi/r2Mirror'

function makeDeps(overrides: { bucket?: R2MirrorBucket } = {}) {
  return {
    getSession: vi.fn().mockResolvedValue({ user: { id: 'u1' } } as Session),
    apiKey: 'SECRET_KEY',
    ...(overrides.bucket ? { bucket: overrides.bucket } : {}),
  }
}

function makeRequest(ref: string, maxWidth?: string): Request {
  const url = new URL('http://localhost/api/google/place-photo')
  url.searchParams.set('ref', ref)
  if (maxWidth) url.searchParams.set('maxwidth', maxWidth)
  return new Request(url.toString())
}

function imageResponse(bytes = new Uint8Array([1, 2, 3]).buffer, contentType = 'image/jpeg'): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': contentType, 'content-length': String(bytes.byteLength) }),
    arrayBuffer: async () => bytes,
  } as unknown as Response
}

describe('place photo handler', () => {
  it('非法 ref（字符集/长度）直接 400，不打上游', async () => {
    const fetchImpl = vi.fn()
    const handlers = createPlacePhotoHandlers({ ...makeDeps(), fetchImpl })
    const bad1 = await handlers.GET(makeRequest('bad ref with spaces!'))
    expect(bad1.status).toBe(400)
    const bad2 = await handlers.GET(makeRequest('short'))
    expect(bad2.status).toBe(400)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('未登录 401；缺 key 503', async () => {
    const anonymous = createPlacePhotoHandlers({
      getSession: vi.fn().mockResolvedValue(null),
      apiKey: 'k',
      fetchImpl: vi.fn(),
    })
    expect((await anonymous.GET(makeRequest('Avalid_reference_123'))).status).toBe(401)

    const noKey = createPlacePhotoHandlers({ ...makeDeps(), apiKey: '', fetchImpl: vi.fn() })
    expect((await noKey.GET(makeRequest('Avalid_reference_123'))).status).toBe(503)
  })

  it('上游 URL 服务端拼 key；canonical URL（镜像/响应头/日志）永远 keyless', async () => {
    const fetchImpl = vi.fn(async () => imageResponse())
    const handlers = createPlacePhotoHandlers({ ...makeDeps(), fetchImpl })
    const res = await handlers.GET(makeRequest('Avalid_reference_123'))
    expect(res.status).toBe(200)

    const upstreamUrl = String((fetchImpl as Mock).mock.calls[0]![0])
    expect(upstreamUrl).toContain('key=SECRET_KEY')
    expect(upstreamUrl).toContain('photoreference=Avalid_reference_123')

    expect(res.headers.get('X-Original-Source')).toBe(buildPhotoCanonicalUrl('Avalid_reference_123', 1600))
    expect(res.headers.get('X-Original-Source')).not.toContain('key=')
  })

  it('非图片 MIME → 415；上游失败 → 502', async () => {
    const html = createPlacePhotoHandlers({
      ...makeDeps(),
      fetchImpl: vi.fn(async () => imageResponse(new ArrayBuffer(4), 'text/html')),
    })
    expect((await html.GET(makeRequest('Avalid_reference_123'))).status).toBe(415)

    const failing = createPlacePhotoHandlers({
      ...makeDeps(),
      fetchImpl: vi.fn(async () => ({ ok: false, status: 403 }) as unknown as Response),
    })
    expect((await failing.GET(makeRequest('Avalid_reference_123'))).status).toBe(502)
  })

  it('M3 修订：302 到 Google 图片 CDN（lh3/lh5-x.googleusercontent.com）逐跳校验后跟随并出图', async () => {
    const imageBytes = new Uint8Array([7, 7, 7]).buffer
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.startsWith('https://maps.googleapis.com/')) {
        return new Response(null, {
          status: 302,
          headers: { location: 'https://lh3.googleusercontent.com/a/p.jpg?keyp=x' },
        })
      }
      if (url.startsWith('https://lh3.googleusercontent.com/')) {
        return new Response(null, {
          status: 302,
          headers: { location: 'https://lh5-x.googleusercontent.com/a/p.jpg' },
        })
      }
      return imageResponse(imageBytes)
    })
    const handlers = createPlacePhotoHandlers({ ...makeDeps(), fetchImpl })
    const res = await handlers.GET(makeRequest('Avalid_reference_123'))
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('image/jpeg')
    expect(fetchImpl).toHaveBeenCalledTimes(3) // 上游 → lh3 → lh5-x

    // 区域变体 host 也允许（文档化 host 集合内的每一跳都放行）
    const followed = String((fetchImpl as Mock).mock.calls[1]![0])
    expect(followed).toContain('lh3.googleusercontent.com')
  })

  it('M3 修订：302 到非 Google 图片 host（evil.com / 外部协议）被拒绝', async () => {
    for (const location of ['https://evil.com/steal.jpg', 'http://lh3.googleusercontent.com.evil.com/x.jpg', 'ftp://lh3.googleusercontent.com/x']) {
      const fetchImpl = vi.fn(async () =>
        new Response(null, { status: 302, headers: { location } }) as unknown as Response,
      )
      const handlers = createPlacePhotoHandlers({ ...makeDeps(), fetchImpl })
      const res = await handlers.GET(makeRequest('Avalid_reference_123'))
      expect(res.status).toBe(502)
      expect(await res.json()).toMatchObject({ error: '不支持的重定向' })
      expect(fetchImpl).toHaveBeenCalledTimes(1) // 重定向未被跟随
    }
  })

  it('重定向次数超限 → 508 重定向过多（与不支持重定向的 502 可区分）', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(null, { status: 302, headers: { location: 'https://lh3.googleusercontent.com/a/p.jpg' } }) as unknown as Response,
    )
    const handlers = createPlacePhotoHandlers({ ...makeDeps(), fetchImpl })
    const res = await handlers.GET(makeRequest('Avalid_reference_123'))
    expect(res.status).toBe(508)
    expect(await res.json()).toMatchObject({ error: '重定向过多' })
  })

  it('R2 read-through：镜像命中直接返回，不打上游', async () => {
    const fetchImpl = vi.fn()
    const bytes = new Uint8Array([9, 9, 9]).buffer
    const bucket: R2MirrorBucket = {
      head: vi.fn(async () => null),
      get: vi.fn(async () => ({
        arrayBuffer: async () => bytes,
        customMetadata: {
          originalUrl: buildPhotoCanonicalUrl('Avalid_reference_123', 1600),
          mimeType: 'image/jpeg',
          mirroredAt: '2026-09-01T00:00:00.000Z',
          mirrorSource: 'lazy',
          contentLength: '3',
        },
        httpMetadata: { contentType: 'image/jpeg' },
        size: 3,
      })),
      put: vi.fn(async () => undefined),
    }
    const handlers = createPlacePhotoHandlers({ ...makeDeps({ bucket }), fetchImpl })
    const res = await handlers.GET(makeRequest('Avalid_reference_123'))
    expect(res.status).toBe(200)
    expect(res.headers.get('X-Seichigo-Image-Source')).toBe('google-place-photo-r2')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('镜像未命中：上游成功后异步镜像，写入的 canonical/metadata 不含 key', async () => {
    const bytes = new Uint8Array([1, 1]).buffer
    const put = vi.fn(async () => undefined)
    const bucket: R2MirrorBucket = {
      head: vi.fn(async () => null),
      get: vi.fn(async () => null),
      put,
    }
    const waitUntil = vi.fn()
    const handlers = createPlacePhotoHandlers({
      ...makeDeps({ bucket }),
      fetchImpl: vi.fn(async () => imageResponse(bytes)),
      waitUntil,
    })
    const res = await handlers.GET(makeRequest('Avalid_reference_123', '800'))
    expect(res.status).toBe(200)
    expect(res.headers.get('X-Seichigo-Image-Source')).toBe('google-place-photo-upstream')

    // 后台镜像经由 waitUntil 派发；等它落地后断言 metadata 无密钥
    await Promise.all(waitUntil.mock.calls.map(([p]) => p as Promise<unknown>))
    expect(put).toHaveBeenCalledTimes(1)
    const [key, writtenBytes, options] = put.mock.calls[0] as unknown as [string, ArrayBuffer, { customMetadata: Record<string, string> }]
    expect(key).toContain('maps.googleapis.com')
    expect(options.customMetadata.originalUrl).not.toContain('key=')
    expect(options.customMetadata.originalUrl).toContain('photoreference=Avalid_reference_123')
    expect(options.customMetadata.mirroredAt).toBeTruthy()
    expect(options.customMetadata.mirrorSource).toBe('lazy')
    expect(writtenBytes.byteLength).toBe(2)
    // 全程任何持久化字段都不包含密钥
    expect(JSON.stringify(put.mock.calls)).not.toContain('SECRET_KEY')
  })
})

describe('place photo handler（placeId 寻址路径）', () => {
  const storedPlace: ResolvedPlace & { photoMirrorStatus: 'none'; photoMirrorKey: null } = {
    provider: 'google',
    placeId: 'ChIJ_newchitose',
    name: '新千歳空港',
    address: null,
    lat: 42.7889,
    lng: 141.6947,
    mapsUri: 'https://www.google.com/maps/place/?q=place_id:ChIJ_newchitose',
    photo: {
      photoReference: 'Aold_REF_1234567890',
      displayUrl: '/api/google/place-photo?placeId=ChIJ_newchitose&maxwidth=1600',
      attribution: 'Old Author',
    },
    fetchedAt: new Date().toISOString(),
    photoMirrorStatus: 'none',
    photoMirrorKey: null,
  }

  function makePlaceIdRequest(placeId: string, maxWidth?: string): Request {
    const url = new URL('http://localhost/api/google/place-photo')
    url.searchParams.set('placeId', placeId)
    if (maxWidth) url.searchParams.set('maxwidth', maxWidth)
    return new Request(url.toString())
  }

  function makeStoreWith(place: ResolvedPlace | null) {
    const store = createMemoryExternalPlaceStore()
    if (place) void store.upsert(place, '新千歳空港')
    const setPhotoMirror = vi.fn(async (...args: Parameters<typeof store.setPhotoMirror>) => {
      await store.setPhotoMirror(...args)
    })
    const updatePhotoReference = vi.fn(async (...args: Parameters<typeof store.updatePhotoReference>) => {
      await store.updatePhotoReference(...args)
    })
    const updatePhotos = vi.fn(async (...args: Parameters<typeof store.updatePhotos>) => {
      await store.updatePhotos(...args)
    })
    return {
      store: { ...store, setPhotoMirror, updatePhotoReference, updatePhotos } as ExternalPlaceStore,
      setPhotoMirror,
      updatePhotoReference,
      updatePhotos,
    }
  }

  it('deps.store 缺省 → 503 地点库未配置', async () => {
    const handlers = createPlacePhotoHandlers({ ...makeDeps(), fetchImpl: vi.fn() })
    const res = await handlers.GET(makePlaceIdRequest('ChIJ_newchitose'))
    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({ error: '地点库未配置' })
  })

  it('未知 placeId / 库里无照片 → 404，不打上游', async () => {
    const fetchImpl = vi.fn()
    const { store } = makeStoreWith(null)
    const handlers = createPlacePhotoHandlers({ ...makeDeps(), store, fetchImpl })
    expect((await handlers.GET(makePlaceIdRequest('ChIJ_unknown000'))).status).toBe(404)
    expect((await handlers.GET(makePlaceIdRequest('ChIJ_newchitose'))).status).toBe(404)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('非法 placeId（过短/带特殊字符）→ 400', async () => {
    const { store } = makeStoreWith(storedPlace)
    const handlers = createPlacePhotoHandlers({ ...makeDeps(), store, fetchImpl: vi.fn() })
    expect((await handlers.GET(makePlaceIdRequest('short'))).status).toBe(400)
    expect((await handlers.GET(makePlaceIdRequest('bad id!'))).status).toBe(400)
  })

  function makeMixedRequest(ref: string, placeId: string): Request {
    const url = new URL('http://localhost/api/google/place-photo')
    url.searchParams.set('ref', ref)
    url.searchParams.set('placeId', placeId)
    return new Request(url.toString())
  }

  it('同时带 ref 与 placeId：placeId 优先（忽略 ref），未校验的 ref 绝不打 Google', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL) => imageResponse())
    const { store } = makeStoreWith(storedPlace)
    const handlers = createPlacePhotoHandlers({ ...makeDeps(), store, fetchImpl })
    const res = await handlers.GET(makeMixedRequest('zz', storedPlace.placeId))
    expect(res.status).toBe(200)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(String(fetchImpl.mock.calls[0]![0])).toContain(`photoreference=${storedPlace.photo!.photoReference}`)
    for (const call of fetchImpl.mock.calls) {
      expect(String(call[0])).not.toContain('photoreference=zz')
    }
  })

  it('同时带 ref 与未知合法 placeId → 走 placeId 路径 404，不打 Google', async () => {
    const fetchImpl = vi.fn()
    const { store } = makeStoreWith(storedPlace)
    const handlers = createPlacePhotoHandlers({ ...makeDeps(), store, fetchImpl })
    const res = await handlers.GET(makeMixedRequest('zz', 'ChIJ3RpcnUUgdV8R9oH25Xxguho'))
    expect(res.status).toBe(404)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('?placeId=x（非法 placeId）→ 400，即使带了合法形状的 ref 也不放行', async () => {
    const fetchImpl = vi.fn()
    const { store } = makeStoreWith(storedPlace)
    const handlers = createPlacePhotoHandlers({ ...makeDeps(), store, fetchImpl })
    expect((await handlers.GET(makePlaceIdRequest('x'))).status).toBe(400)
    expect((await handlers.GET(makeMixedRequest('Avalid_reference_123', 'x'))).status).toBe(400)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('库有行 + R2 命中 → 200 google-place-photo-r2，不打 Google', async () => {
    const fetchImpl = vi.fn()
    const bytes = new Uint8Array([9, 9, 9]).buffer
    const bucket: R2MirrorBucket = {
      head: vi.fn(async () => null),
      get: vi.fn(async () => ({
        arrayBuffer: async () => bytes,
        customMetadata: {
          originalUrl: buildPlacePhotoCanonicalUrl('ChIJ_newchitose', 1600),
          mimeType: 'image/jpeg',
          mirroredAt: '2026-09-01T00:00:00.000Z',
          mirrorSource: 'lazy',
          contentLength: '3',
        },
        httpMetadata: { contentType: 'image/jpeg' },
        size: 3,
      })),
      put: vi.fn(async () => undefined),
    }
    const { store } = makeStoreWith(storedPlace)
    const handlers = createPlacePhotoHandlers({ ...makeDeps({ bucket }), store, fetchImpl })
    const res = await handlers.GET(makePlaceIdRequest('ChIJ_newchitose'))
    expect(res.status).toBe(200)
    expect(res.headers.get('X-Seichigo-Image-Source')).toBe('google-place-photo-r2')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('R2 未命中 → 上游成功 200；bucket.put 经 waitUntil 落 placeId canonical，store.setPhotoMirror(mirrored)', async () => {
    const bytes = new Uint8Array([4, 4]).buffer
    const put = vi.fn(async () => undefined)
    const bucket: R2MirrorBucket = { head: vi.fn(async () => null), get: vi.fn(async () => null), put }
    const waitUntil = vi.fn()
    const { store, setPhotoMirror } = makeStoreWith(storedPlace)
    const handlers = createPlacePhotoHandlers({
      ...makeDeps({ bucket }),
      store,
      fetchImpl: vi.fn(async () => imageResponse(bytes)),
      waitUntil,
    })
    const res = await handlers.GET(makePlaceIdRequest('ChIJ_newchitose', '800'))
    expect(res.status).toBe(200)
    expect(res.headers.get('X-Seichigo-Image-Source')).toBe('google-place-photo-upstream')
    expect(res.headers.get('X-Original-Source')).toBe(buildPlacePhotoCanonicalUrl('ChIJ_newchitose', 800))

    await Promise.all(waitUntil.mock.calls.map(([p]) => p as Promise<unknown>))
    expect(put).toHaveBeenCalledTimes(1)
    const [, , options] = put.mock.calls[0] as unknown as [string, ArrayBuffer, { customMetadata: Record<string, string> }]
    expect(options.customMetadata.originalUrl).not.toContain('key=')
    expect(options.customMetadata.originalUrl).toContain('placeid=ChIJ_newchitose')
    // put 成功才写 mirrored，且带上 key 与 mirroredAt
    expect(setPhotoMirror).toHaveBeenCalledWith(
      'google',
      'ChIJ_newchitose',
      expect.objectContaining({ status: 'mirrored', key: expect.any(String), mirroredAt: expect.any(Date) }),
    )
    expect(JSON.stringify(put.mock.calls)).not.toContain('SECRET_KEY')
  })

  it('无 bucket：上游成功后不写镜像状态（photoMirrorStatus 保持 none）', async () => {
    const waitUntil = vi.fn()
    const { store, setPhotoMirror } = makeStoreWith(storedPlace)
    const handlers = createPlacePhotoHandlers({
      ...makeDeps(),
      store,
      fetchImpl: vi.fn(async () => imageResponse()),
      waitUntil,
    })
    const res = await handlers.GET(makePlaceIdRequest('ChIJ_newchitose'))
    expect(res.status).toBe(200)
    await Promise.all(waitUntil.mock.calls.map(([p]) => p as Promise<unknown>))
    expect(setPhotoMirror).not.toHaveBeenCalled()
    expect((await store.findByPlaceId('google', 'ChIJ_newchitose'))?.photoMirrorStatus).toBe('none')
  })

  it('bucket.put 失败 → store.setPhotoMirror 落 failed（不写 mirrored）', async () => {
    const bucket: R2MirrorBucket = {
      head: vi.fn(async () => null),
      get: vi.fn(async () => null),
      put: vi.fn(async () => {
        throw new Error('r2 down')
      }),
    }
    const waitUntil = vi.fn()
    const { store, setPhotoMirror } = makeStoreWith(storedPlace)
    const handlers = createPlacePhotoHandlers({
      ...makeDeps({ bucket }),
      store,
      fetchImpl: vi.fn(async () => imageResponse()),
      waitUntil,
    })
    const res = await handlers.GET(makePlaceIdRequest('ChIJ_newchitose'))
    expect(res.status).toBe(200)
    await Promise.all(waitUntil.mock.calls.map(([p]) => p as Promise<unknown>))
    expect(setPhotoMirror).toHaveBeenCalledTimes(1)
    expect(setPhotoMirror).toHaveBeenCalledWith('google', 'ChIJ_newchitose', expect.objectContaining({ status: 'failed' }))
    expect((await store.findByPlaceId('google', 'ChIJ_newchitose'))?.photoMirrorStatus).toBe('failed')
  })

  it('上游 403（引用过期）→ fetchPlacePhotos 拉整组、store.updatePhotos 回写、重试成功', async () => {
    const bytes = new Uint8Array([5]).buffer
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.includes('/maps/api/place/details/json')) {
        return {
          ok: true,
          json: async () => ({
            status: 'OK',
            result: { photos: [{ photo_reference: 'Anew_REF_9876543210', html_attributions: [] }] },
          }),
        } as unknown as Response
      }
      if (url.includes('photoreference=Aold_REF_1234567890')) {
        return { ok: false, status: 403 } as unknown as Response
      }
      return imageResponse(bytes)
    })
    const { store, updatePhotos, updatePhotoReference } = makeStoreWith(storedPlace)
    const handlers = createPlacePhotoHandlers({ ...makeDeps(), store, fetchImpl })
    const res = await handlers.GET(makePlaceIdRequest('ChIJ_newchitose'))
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('image/jpeg')
    expect(updatePhotos).toHaveBeenCalledTimes(1)
    expect(updatePhotos).toHaveBeenCalledWith('google', 'ChIJ_newchitose', [{ photoReference: 'Anew_REF_9876543210', attribution: null }])
    expect(updatePhotoReference).not.toHaveBeenCalled()
    // 刷新后的引用已回写库记录
    expect((await store.findByPlaceId('google', 'ChIJ_newchitose'))?.photo?.photoReference).toBe('Anew_REF_9876543210')
  })

  it('刷新后仍失败 → 502，photoMirrorStatus 落 failed', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.includes('/maps/api/place/details/json')) {
        return {
          ok: true,
          json: async () => ({ status: 'OK', result: { photos: [{ photo_reference: 'Anew_REF_9876543210', html_attributions: [] }] } }),
        } as unknown as Response
      }
      return { ok: false, status: 403 } as unknown as Response
    })
    const { store, setPhotoMirror } = makeStoreWith(storedPlace)
    const handlers = createPlacePhotoHandlers({ ...makeDeps(), store, fetchImpl })
    const res = await handlers.GET(makePlaceIdRequest('ChIJ_newchitose'))
    expect(res.status).toBe(502)
    expect(setPhotoMirror).toHaveBeenCalledWith('google', 'ChIJ_newchitose', expect.objectContaining({ status: 'failed' }))
  })

  describe('A3：i 参数按序号取图', () => {
    const multiPhotoPlace: ResolvedPlace = {
      ...storedPlace,
      photos: [
        { photoReference: 'Aold_REF_1234567890', attribution: 'Old Author' },
        { photoReference: 'Aphoto_index_1', attribution: 'Author 1' },
        { photoReference: 'Aphoto_index_2', attribution: 'Author 2' },
      ],
    }

    function makeIndexRequest(placeId: string, index: string, maxWidth?: string): Request {
      const url = new URL('http://localhost/api/google/place-photo')
      url.searchParams.set('placeId', placeId)
      url.searchParams.set('i', index)
      if (maxWidth) url.searchParams.set('maxwidth', maxWidth)
      return new Request(url.toString())
    }

    it('i=1 取第二张照片（fetch 的 photoreference 是第二个）', async () => {
      const fetchImpl = vi.fn(async (_input: RequestInfo | URL) => imageResponse())
      const { store } = makeStoreWith(multiPhotoPlace)
      const handlers = createPlacePhotoHandlers({ ...makeDeps(), store, fetchImpl })
      const res = await handlers.GET(makeIndexRequest('ChIJ_newchitose', '1'))
      expect(res.status).toBe(200)
      expect(fetchImpl).toHaveBeenCalledTimes(1)
      expect(String(fetchImpl.mock.calls[0]![0])).toContain('photoreference=Aphoto_index_1')
      // canonical（R2 key 输入）带 i=1
      expect(res.headers.get('X-Original-Source')).toBe(buildPlacePhotoCanonicalUrl('ChIJ_newchitose', 1600, 1))
    })

    it('i=0 与缺省等价：fetch 第一个引用，canonical 不带 i', async () => {
      const fetchImpl = vi.fn(async (_input: RequestInfo | URL) => imageResponse())
      const { store } = makeStoreWith(multiPhotoPlace)
      const handlers = createPlacePhotoHandlers({ ...makeDeps(), store, fetchImpl })
      const res = await handlers.GET(makeIndexRequest('ChIJ_newchitose', '0'))
      expect(res.status).toBe(200)
      expect(String(fetchImpl.mock.calls[0]![0])).toContain('photoreference=Aold_REF_1234567890')
      expect(res.headers.get('X-Original-Source')).toBe(buildPlacePhotoCanonicalUrl('ChIJ_newchitose', 1600, 0))
    })

    it('i=5 超出该地点已知照片数 → 404，不打上游', async () => {
      const fetchImpl = vi.fn()
      const { store } = makeStoreWith(multiPhotoPlace)
      const handlers = createPlacePhotoHandlers({ ...makeDeps(), store, fetchImpl })
      const res = await handlers.GET(makeIndexRequest('ChIJ_newchitose', '5'))
      expect(res.status).toBe(404)
      expect(fetchImpl).not.toHaveBeenCalled()
    })

    it('i=abc / 负数 / >9 → 400，不打上游', async () => {
      const fetchImpl = vi.fn()
      const { store } = makeStoreWith(multiPhotoPlace)
      const handlers = createPlacePhotoHandlers({ ...makeDeps(), store, fetchImpl })
      for (const bad of ['abc', '-1', '10', '1.5']) {
        const res = await handlers.GET(makeIndexRequest('ChIJ_newchitose', bad))
        expect(res.status).toBe(400)
      }
      expect(fetchImpl).not.toHaveBeenCalled()
    })

    it('R10：不带 placeId 只带 ref 且 i>0 → 400，不打上游', async () => {
      const fetchImpl = vi.fn()
      const handlers = createPlacePhotoHandlers({ ...makeDeps(), fetchImpl })
      const url = new URL('http://localhost/api/google/place-photo')
      url.searchParams.set('ref', 'Avalid_reference_123')
      url.searchParams.set('i', '1')
      const res = await handlers.GET(new Request(url.toString()))
      expect(res.status).toBe(400)
      expect(fetchImpl).not.toHaveBeenCalled()
    })

    it('R6：i=1 上游成功仍然 put R2（canonical 带 i），但 setPhotoMirror 未被调用；i=1 失败也不写 failed', async () => {
      const put = vi.fn(async () => undefined)
      const bucket: R2MirrorBucket = { head: vi.fn(async () => null), get: vi.fn(async () => null), put }
      const waitUntil = vi.fn()
      const { store, setPhotoMirror } = makeStoreWith(multiPhotoPlace)
      const success = createPlacePhotoHandlers({
        ...makeDeps({ bucket }),
        store,
        fetchImpl: vi.fn(async () => imageResponse()),
        waitUntil,
      })
      const res = await success.GET(makeIndexRequest('ChIJ_newchitose', '1'))
      expect(res.status).toBe(200)
      await Promise.all(waitUntil.mock.calls.map(([p]) => p as Promise<unknown>))
      expect(put).toHaveBeenCalledTimes(1) // 镜像照常写（canonical 带 i=1）
      expect(setPhotoMirror).not.toHaveBeenCalled() // 但镜像状态列不动
      expect((await store.findByPlaceId('google', 'ChIJ_newchitose'))?.photoMirrorStatus).toBe('none')

      const failing = createPlacePhotoHandlers({
        ...makeDeps({ bucket }),
        store,
        fetchImpl: vi.fn(async () => ({ ok: false, status: 403 }) as unknown as Response),
        waitUntil,
      })
      expect((await failing.GET(makeIndexRequest('ChIJ_newchitose', '1'))).status).toBe(502)
      expect(setPhotoMirror).not.toHaveBeenCalled() // 失败同样不写 failed
    })

    it('引用过期时按 index 重试：刷新整组后取 photos[index]', async () => {
      const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString()
        if (url.includes('/maps/api/place/details/json')) {
          return {
            ok: true,
            json: async () => ({
              status: 'OK',
              result: {
                photos: [
                  { photo_reference: 'Anew_first___01', html_attributions: [] },
                  { photo_reference: 'Anew_second__02', html_attributions: ['<a href="x">S</a>'] },
                ],
              },
            }),
          } as unknown as Response
        }
        return { ok: false, status: 403 } as unknown as Response
      })
      const { store, updatePhotos } = makeStoreWith(multiPhotoPlace)
      const handlers = createPlacePhotoHandlers({ ...makeDeps(), store, fetchImpl })
      const res = await handlers.GET(makeIndexRequest('ChIJ_newchitose', '1'))
      expect(res.status).toBe(502) // 旧 index=1 引用 403 → 刷新 → 新 index=1 引用仍 403 → 失败
      expect(updatePhotos).toHaveBeenCalledWith('google', 'ChIJ_newchitose', [
        { photoReference: 'Anew_first___01', attribution: null },
        { photoReference: 'Anew_second__02', attribution: 'S' },
      ])
    })
  })
})
