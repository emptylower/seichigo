import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  LAYOUT_STORAGE_KEY,
  createShareLink,
  readPreferredLayout,
  transcodeToJpeg,
  uploadShareAssets,
  writePreferredLayout,
} from '@/components/share/shareClient'

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  globalThis.localStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('createShareLink', () => {
  it('POST /api/share/links 并返回 code/url', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ code: 'AbC12xYz', url: 'https://seichigo.com/s/AbC12xYz' }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const result = await createShareLink({
      pointId: '101:suga',
      bangumiId: 101,
      locale: 'zh',
      layout: 'portrait',
    })
    expect(result).toEqual({ code: 'AbC12xYz', url: 'https://seichigo.com/s/AbC12xYz' })
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('/api/share/links')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({
      pointId: '101:suga',
      bangumiId: 101,
      locale: 'zh',
      layout: 'portrait',
    })
  })

  it('非 2xx 返回 null 而不是抛', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'nope' }), { status: 429 }))
    await expect(
      createShareLink({ pointId: 'p', bangumiId: 1, locale: 'zh', layout: 'portrait' }),
    ).resolves.toBeNull()
  })
})

describe('uploadShareAssets', () => {
  it('把 card/photo 塞进 FormData', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true, imageUrl: '/api/share/img/AbC12xYz', photoUrl: null }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const card = new Blob([new Uint8Array(1)], { type: 'image/jpeg' })
    const photo = new File([new Uint8Array(1)], 'p.jpg', { type: 'image/jpeg' })
    const result = await uploadShareAssets('AbC12xYz', card, photo)
    expect(result?.imageUrl).toBe('/api/share/img/AbC12xYz')
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('/api/share/links/AbC12xYz/upload')
    const form = init.body as FormData
    expect(form.get('card')).toBeInstanceOf(File)
    expect(form.get('photo')).toBeInstanceOf(File)
  })

  it('401 时返回 null（匿名分享照常，只是不上传）', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: '请先登录' }), { status: 401 }))
    const card = new Blob([new Uint8Array(1)], { type: 'image/jpeg' })
    await expect(uploadShareAssets('AbC12xYz', card, null)).resolves.toBeNull()
  })
})

describe('transcodeToJpeg', () => {
  it('把位图转成 JPEG blob（质量 0.85）', async () => {
    const close = vi.fn()
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 4, height: 2, close })))
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as never)
    const toBlobSpy = vi
      .spyOn(HTMLCanvasElement.prototype, 'toBlob')
      .mockImplementation((callback: BlobCallback, _type?: string, _quality?: number) => {
        callback(new Blob([new Uint8Array(1)], { type: 'image/jpeg' }))
      })
    const result = await transcodeToJpeg(new File([new Uint8Array(2)], 'a.heic', { type: 'image/heic' }))
    expect(result?.type).toBe('image/jpeg')
    expect(toBlobSpy).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', 0.85)
    expect(close).toHaveBeenCalled()
  })

  it('解码失败返回 null', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => {
        throw new Error('decode failed')
      }),
    )
    await expect(
      transcodeToJpeg(new File([new Uint8Array(2)], 'a.heic', { type: 'image/heic' })),
    ).resolves.toBeNull()
  })
})

describe('版式记忆', () => {
  it('没存过时返回 portrait', () => {
    expect(readPreferredLayout()).toBe('portrait')
  })

  it('存过就读回来，非法值忽略', () => {
    writePreferredLayout('landscape')
    expect(globalThis.localStorage.getItem(LAYOUT_STORAGE_KEY)).toBe('landscape')
    expect(readPreferredLayout()).toBe('landscape')
    globalThis.localStorage.setItem(LAYOUT_STORAGE_KEY, 'square')
    expect(readPreferredLayout()).toBe('portrait')
  })
})
