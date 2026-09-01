import { describe, it, expect, vi, type Mock } from 'vitest'
import type { Session } from 'next-auth'
import { createPlacePhotoHandlers, buildPhotoCanonicalUrl } from '@/lib/googlePlaces/handlers/placePhoto'
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
      expect(fetchImpl).toHaveBeenCalledTimes(1) // 重定向未被跟随
    }
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
