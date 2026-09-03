import { describe, it, expect, vi } from 'vitest'
import { buildPlacePhotoCanonicalUrl, fetchGooglePlacePhoto } from '@/lib/googlePlaces/photoFetch'

function imageResponse(bytes = new Uint8Array([1, 2, 3]).buffer, contentType = 'image/jpeg'): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': contentType, 'content-length': String(bytes.byteLength) }),
    arrayBuffer: async () => bytes,
  } as unknown as Response
}

function redirectResponse(location: string): Response {
  return new Response(null, { status: 302, headers: { location } })
}

describe('fetchGooglePlacePhoto（带 key 抓取 + 逐跳白名单校验 + MIME/大小限制）', () => {
  const base = { photoReference: 'Avalid_reference_123', maxWidth: 1600, apiKey: 'SECRET_KEY' }

  it('302 白名单跳转（maps.googleapis.com → lh3 → lh5-x 区域变体）成功返回 bytes/mime', async () => {
    const imageBytes = new Uint8Array([7, 7, 7]).buffer
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.startsWith('https://maps.googleapis.com/')) {
        return redirectResponse('https://lh3.googleusercontent.com/a/p.jpg?keyp=x')
      }
      if (url.startsWith('https://lh3.googleusercontent.com/')) {
        return redirectResponse('https://lh5-x.googleusercontent.com/a/p.jpg')
      }
      return imageResponse(imageBytes)
    })
    const result = await fetchGooglePlacePhoto({ ...base, fetchImpl })
    expect(result).toEqual({ ok: true, bytes: imageBytes, mimeType: 'image/jpeg' })
    expect(fetchImpl).toHaveBeenCalledTimes(3)
    // 上游请求 URL 服务端拼 key；canonical 输入绝不带 key
    const firstUrl = String(fetchImpl.mock.calls[0]![0])
    expect(firstUrl).toContain('key=SECRET_KEY')
    expect(firstUrl).toContain('photoreference=Avalid_reference_123')
    expect(firstUrl).toContain('maxwidth=1600')
    expect(JSON.stringify(result)).not.toContain('SECRET_KEY')
  })

  it('非白名单 Location（evil.com / 外部协议 / host 仿冒）→ redirect 拒绝且不跟随', async () => {
    for (const location of ['https://evil.com/steal.jpg', 'http://lh3.googleusercontent.com.evil.com/x.jpg', 'ftp://lh3.googleusercontent.com/x']) {
      const fetchImpl = vi.fn(async () => redirectResponse(location))
      const result = await fetchGooglePlacePhoto({ ...base, fetchImpl })
      expect(result).toMatchObject({ ok: false, status: 'redirect' })
      expect(fetchImpl).toHaveBeenCalledTimes(1)
    }
  })

  it('403 → denied；404/400 → not_found；其他非 2xx → upstream', async () => {
    expect(await fetchGooglePlacePhoto({ ...base, fetchImpl: vi.fn(async () => ({ ok: false, status: 403 }) as unknown as Response) })).toMatchObject({ ok: false, status: 'denied' })
    expect(await fetchGooglePlacePhoto({ ...base, fetchImpl: vi.fn(async () => ({ ok: false, status: 404 }) as unknown as Response) })).toMatchObject({ ok: false, status: 'not_found' })
    expect(await fetchGooglePlacePhoto({ ...base, fetchImpl: vi.fn(async () => ({ ok: false, status: 500 }) as unknown as Response) })).toMatchObject({ ok: false, status: 'upstream' })
  })

  it('content-type: text/html → bad_type', async () => {
    const result = await fetchGooglePlacePhoto({
      ...base,
      fetchImpl: vi.fn(async () => imageResponse(new ArrayBuffer(4), 'text/html')),
    })
    expect(result).toMatchObject({ ok: false, status: 'bad_type' })
  })

  it('超 10MB（content-length 声明或实际字节）→ too_large', async () => {
    const huge = new Uint8Array(10 * 1024 * 1024 + 1).buffer
    const declared = {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'image/jpeg', 'content-length': String(11 * 1024 * 1024) }),
      arrayBuffer: async () => new ArrayBuffer(4),
    } as unknown as Response
    expect(await fetchGooglePlacePhoto({ ...base, fetchImpl: vi.fn(async () => declared) })).toMatchObject({ ok: false, status: 'too_large' })
    expect(
      await fetchGooglePlacePhoto({
        ...base,
        fetchImpl: vi.fn(async () => imageResponse(huge)),
      }),
    ).toMatchObject({ ok: false, status: 'too_large' })
  })

  it('网络异常/超时 → timeout；重定向过多 → too_many_redirects（与上游 5xx 的 upstream 可区分）', async () => {
    const throwing = vi.fn(async () => {
      throw new Error('Network connection lost.')
    })
    expect(await fetchGooglePlacePhoto({ ...base, fetchImpl: throwing })).toMatchObject({ ok: false, status: 'timeout' })

    const looping = vi.fn(async () => redirectResponse('https://lh3.googleusercontent.com/a/p.jpg'))
    expect(await fetchGooglePlacePhoto({ ...base, fetchImpl: looping })).toMatchObject({ ok: false, status: 'too_many_redirects' })
  })
})

describe('buildPlacePhotoCanonicalUrl（placeId 寻址的 keyless canonical，只作 R2 key 输入）', () => {
  it('合成 canonical 且不含任何密钥', () => {
    const url = buildPlacePhotoCanonicalUrl('ChIJ_newchitose', 1600)
    expect(url).toBe('https://maps.googleapis.com/maps/api/place/photo?maxwidth=1600&placeid=ChIJ_newchitose')
    expect(url).not.toContain('key=')
  })
})
