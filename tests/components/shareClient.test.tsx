import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  LAYOUT_STORAGE_KEY,
  createShareLink,
  fetchCardBlob,
  fetchPointContext,
  openBlankWindow,
  openOrNavigate,
  readPreferredLayout,
  transcodeToJpeg,
  uploadSharePhoto,
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

describe('fetchCardBlob', () => {
  it('把卡片 URL 取成 blob', async () => {
    // 注意：jsdom 的 Blob 与 undici 的 Response 不同 realm，new Response(blob) 会被
    // 字符串化成 "[object Blob]"，所以 mock 一律用字节构造，断言落在 size/type 上
    const fetchMock = vi.fn(
      async () =>
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { 'content-type': 'image/webp' },
        }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const out = await fetchCardBlob('/api/share/card/p1?locale=zh&layout=landscape')
    expect(out).not.toBeNull()
    expect(out!.size).toBe(3)
    expect(out!.type).toBe('image/webp')
    expect(fetchMock).toHaveBeenCalledWith('/api/share/card/p1?locale=zh&layout=landscape')
  })

  it('非 2xx 返回 null', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x', { status: 500 })))
    expect(await fetchCardBlob('/api/share/card/p1')).toBeNull()
  })

  it('302 到跨域兜底图（无 CORS 头）时返回 null', async () => {
    // 真实构造一条重定向响应：302 + Location 指向跨域的 img.seichigo.com。
    // 浏览器跟着这条重定向走时，目标没有 Access-Control-Allow-Origin，fetch 直接
    // 抛 TypeError；这里 mock 不跟随、把 302 原样交回来。两条路径的结果都必须是 null。
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.redirect('https://img.seichigo.com/og-fallback.png', 302)),
    )
    await expect(fetchCardBlob('/api/share/card/p1')).resolves.toBeNull()
  })

  it('抛错返回 null', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline')
      }),
    )
    expect(await fetchCardBlob('/api/share/card/p1')).toBeNull()
  })
})

describe('uploadSharePhoto', () => {
  it('只带 photo 字段发到上传端点，回传 photoKey', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ ok: true, imageUrl: null, photoUrl: '/api/share/photo/u1/p1', photoKey: 'checkin/u1/p1.jpg' }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    )
    vi.stubGlobal('fetch', fetchMock)
    const file = new File([new Uint8Array([1])], 'p.jpg', { type: 'image/jpeg' })
    const out = await uploadSharePhoto('AbC12xYz', file)
    expect(out?.photoKey).toBe('checkin/u1/p1.jpg')
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/share/links/AbC12xYz/upload')
    expect(init.method).toBe('POST')
    const form = init.body as FormData
    expect(form.get('photo')).toBeInstanceOf(File)
    expect(form.get('card')).toBeNull()
  })

  it('401 / 429 / 503 都返回 null', async () => {
    for (const status of [401, 429, 503]) {
      vi.stubGlobal('fetch', vi.fn(async () => new Response('x', { status })))
      const file = new File([new Uint8Array([1])], 'p.jpg', { type: 'image/jpeg' })
      expect(await uploadSharePhoto('AbC12xYz', file), String(status)).toBeNull()
    }
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

describe('fetchPointContext', () => {
  const CONTEXT = {
    address: '東京都 武蔵野市 中町一丁目',
    geo: [35.7, 139.56],
    note: '联名饮品',
    inJapan: true,
    displayName: '葡萄牛奶',
    animeTitle: '摇曳露营△ 三期',
  }

  it('GET /api/share/point-context 并带 pointId 与 locale', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(CONTEXT), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    await expect(fetchPointContext('101:budo', 'ja')).resolves.toEqual(CONTEXT)
    expect(fetchMock.mock.calls[0]![0]).toBe(
      '/api/share/point-context?pointId=101%3Abudo&locale=ja',
    )
  })

  it('非 2xx 返回 null 而不是抛', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 429 }))
    await expect(fetchPointContext('101:budo', 'zh')).resolves.toBeNull()
  })

  it('网络异常返回 null', async () => {
    fetchMock.mockRejectedValue(new Error('offline'))
    await expect(fetchPointContext('101:budo', 'zh')).resolves.toBeNull()
  })
})

describe('openBlankWindow / openOrNavigate', () => {
  it('同步开一个空白窗口并拿到引用', () => {
    const win = { location: { href: '' } }
    const openSpy = vi.fn(() => win)
    vi.stubGlobal('open', openSpy)
    expect(openBlankWindow()).toBe(win)
    expect(openSpy).toHaveBeenCalledWith('about:blank')
  })

  it('弹窗被拦截时返回 null', () => {
    vi.stubGlobal('open', vi.fn(() => null))
    expect(openBlankWindow()).toBeNull()
  })

  it('有窗口引用时先断开 opener 再改写它的 location', () => {
    const win = { location: { href: '' }, opener: {} } as unknown as Window
    expect(openOrNavigate(win, 'https://x.com/intent')).toBe(true)
    expect(win.opener).toBeNull()
    expect(win.location.href).toBe('https://x.com/intent')
  })

  it('没有窗口引用时退回再开一次：不带 noopener 特性串，手动断开 opener', () => {
    const popup = { opener: {} } as unknown as Window
    // 真实语义 stub：带 'noopener' 特性串的 open 一律被拦（返回 null）
    const openSpy = vi.fn((_url: string, _target?: string, features?: string) =>
      features?.includes('noopener') ? null : popup,
    )
    vi.stubGlobal('open', openSpy)
    expect(openOrNavigate(null, 'https://x.com/intent')).toBe(true)
    expect(openSpy).toHaveBeenCalledWith('https://x.com/intent', '_blank')
    expect((popup as { opener: unknown }).opener).toBeNull()
  })

  it('兜底也被拦截时返回 false', () => {
    vi.stubGlobal('open', vi.fn(() => null))
    expect(openOrNavigate(null, 'https://x.com/intent')).toBe(false)
  })
})
