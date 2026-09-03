import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { normalizePointThumbnailUrl } from '@/components/map/utils/normalizePointThumbnailUrl'
import {
  appendMapImageDiagnosticParams,
  getMapDisplayImageCandidates,
  readMapImageDiagnosticParams,
  stripMapImageDiagnosticParams,
  toCanvasSafeImageUrl,
  toMapDisplayImageUrl,
} from '@/lib/anitabi/imageProxy'

const originalWindow = globalThis.window

beforeEach(() => {
  Object.defineProperty(globalThis, 'window', {
    value: {
      location: {
        origin: 'https://seichigo.com',
      },
    },
    configurable: true,
  })
})

afterEach(() => {
  if (originalWindow) {
    Object.defineProperty(globalThis, 'window', {
      value: originalWindow,
      configurable: true,
    })
    return
  }

  Reflect.deleteProperty(globalThis, 'window')
})

describe('toCanvasSafeImageUrl', () => {
  it('returns same-origin images without proxying', () => {
    expect(toCanvasSafeImageUrl('https://seichigo.com/images/cover.jpg', 'cover-name')).toBe(
      'https://seichigo.com/images/cover.jpg',
    )
  })

  it('routes cross-origin images through the render proxy', () => {
    expect(toCanvasSafeImageUrl('https://bgm.tv/cover.jpg')).toBe(
      'https://seichigo.com/api/anitabi/image-render?url=https%253A%252F%252Fbgm.tv%252Fcover.jpg',
    )
  })

  it('keeps anitabi image assets direct but resolves them onto the delivery host', () => {
    expect(toCanvasSafeImageUrl('https://image.anitabi.cn/bangumi/290980.jpg')).toBe(
      'https://img-tc.anitabi.cn/bangumi/290980.jpg',
    )
  })

  it('resolves any anitabi subdomain canvas-safe url onto the delivery host', () => {
    expect(toCanvasSafeImageUrl('https://image.anitabi.cn/ptheme/anitabi/full/1.webp')).toBe(
      'https://img-tc.anitabi.cn/ptheme/anitabi/full/1.webp',
    )
  })

  it('does not include name in the render proxy url', () => {
    const fooUrl = toCanvasSafeImageUrl('https://bgm.tv/cover.jpg', 'foo-name')
    const barUrl = toCanvasSafeImageUrl('https://bgm.tv/cover.jpg', 'bar-name')

    expect(fooUrl).toBe('https://seichigo.com/api/anitabi/image-render?url=https%253A%252F%252Fbgm.tv%252Fcover.jpg')
    expect(barUrl).toBe(fooUrl)
    expect(fooUrl).not.toContain('name=')
  })
})

describe('toMapDisplayImageUrl', () => {
  it('rewrites bgm cover urls to medium size for cover displays', () => {
    expect(toMapDisplayImageUrl('https://lain.bgm.tv/pic/cover/l/b8/0d/513345_jv4wM.jpg', { kind: 'cover' })).toBe(
      'https://seichigo.com/api/anitabi/image-render?url=https%253A%252F%252Flain.bgm.tv%252Fpic%252Fcover%252Fm%252Fb8%252F0d%252F513345_jv4wM.jpg',
    )
  })

  it('routes anitabi point images through the render proxy without adding resize params on non-point paths', () => {
    expect(toMapDisplayImageUrl('https://www.anitabi.cn/images/user/0/a.jpg', { kind: 'point' })).toBe(
      'https://seichigo.com/api/anitabi/image-render?url=https%253A%252F%252Fimage.anitabi.cn%252Fuser%252F0%252Fa.jpg',
    )
  })

  it('routes user-uploaded anitabi point paths through the render proxy with w=640&q=80 for point displays', () => {
    expect(
      toMapDisplayImageUrl('https://image.anitabi.cn/user/0/bangumi/899/points/x.jpg', { kind: 'point' }),
    ).toBe(
      'https://seichigo.com/api/anitabi/image-render?url=https%253A%252F%252Fimage.anitabi.cn%252Fuser%252F0%252Fbangumi%252F899%252Fpoints%252Fx.jpg%253Fw%253D640%2526q%253D80',
    )
  })

  it('routes user-uploaded anitabi point paths to the h160 variant for point-thumbnail displays', () => {
    expect(
      toMapDisplayImageUrl('https://image.anitabi.cn/user/0/bangumi/899/points/x.jpg', { kind: 'point-thumbnail' }),
    ).toBe(
      'https://seichigo.com/api/anitabi/image-render?url=https%253A%252F%252Fimage.anitabi.cn%252Fuser%252F0%252Fbangumi%252F899%252Fpoints%252Fx.jpg%253Fplan%253Dh160',
    )
  })

  it('decodes candidate url params to w=640&q=80 (no plan) for user-uploaded point paths in point mode', () => {
    const candidates = getMapDisplayImageCandidates(
      'https://image.anitabi.cn/user/0/bangumi/899/points/x.jpg',
      { kind: 'point' },
    )

    expect(candidates.length).toBeGreaterThan(0)
    for (const candidate of candidates) {
      // E2 双重编码：searchParams.get 解一层，decodeURIComponent 再解一层
      const proxied = decodeURIComponent(new URL(candidate).searchParams.get('url') || '')
      expect(proxied).toBe('https://image.anitabi.cn/user/0/bangumi/899/points/x.jpg?w=640&q=80')
      expect(proxied).not.toContain('plan=')
    }
  })

  it('decodes candidate url params to plan=h160 for /points/ paths in point-thumbnail mode', () => {
    const candidates = getMapDisplayImageCandidates('https://image.anitabi.cn/points/38125/y.jpg', {
      kind: 'point-thumbnail',
    })

    expect(candidates.length).toBeGreaterThan(0)
    for (const candidate of candidates) {
      const proxied = decodeURIComponent(new URL(candidate).searchParams.get('url') || '')
      expect(proxied).toBe('https://image.anitabi.cn/points/38125/y.jpg?plan=h160')
    }
  })

  it('decodes candidate url params to w=640&q=80 for /points/ paths in point mode', () => {
    const candidates = getMapDisplayImageCandidates('https://image.anitabi.cn/points/38125/y.jpg', { kind: 'point' })

    expect(candidates.length).toBeGreaterThan(0)
    for (const candidate of candidates) {
      const proxied = decodeURIComponent(new URL(candidate).searchParams.get('url') || '')
      expect(proxied).toBe('https://image.anitabi.cn/points/38125/y.jpg?w=640&q=80')
      expect(proxied).not.toContain('plan=')
    }
  })

  it('routes anitabi point-photo paths through the render proxy with width-based resizing preserved', () => {
    expect(
      toMapDisplayImageUrl('https://image.anitabi.cn/points/217249/db2c913d_1754363336601.jpg?w=640&q=80', { kind: 'point' }),
    ).toBe(
      'https://seichigo.com/api/anitabi/image-render?url=https%253A%252F%252Fimage.anitabi.cn%252Fpoints%252F217249%252Fdb2c913d_1754363336601.jpg%253Fw%253D640%2526q%253D80',
    )
  })

  it('routes point thumbnail displays through the render proxy', () => {
    expect(toMapDisplayImageUrl('https://www.anitabi.cn/images/user/0/a.jpg', { kind: 'point-thumbnail' })).toBe(
      'https://seichigo.com/api/anitabi/image-render?url=https%253A%252F%252Fimage.anitabi.cn%252Fuser%252F0%252Fa.jpg%253Fplan%253Dh160',
    )
  })

  it('prefers direct anitabi bangumi covers on the delivery host with proxy fallback candidates', () => {
    expect(getMapDisplayImageCandidates('https://www.anitabi.cn/bangumi/290980.jpg', { kind: 'cover' })).toEqual([
      // direct 一档切到 EdgeOne 投递 host；proxy 一档保留 canonical host 由服务端再解析。
      'https://img-tc.anitabi.cn/bangumi/290980.jpg',
      'https://img-tc.anitabi.cn/bangumi/290980.jpg?_retry=1',
      'https://seichigo.com/api/anitabi/image-render?url=https%253A%252F%252Fimage.anitabi.cn%252Fbangumi%252F290980.jpg',
    ])
    expect(toMapDisplayImageUrl('https://www.anitabi.cn/bangumi/290980.jpg', { kind: 'cover' })).toBe(
      'https://img-tc.anitabi.cn/bangumi/290980.jpg',
    )
  })

  it('keeps point-photo urls on the proxy-only lane with proxy retry fallback', () => {
    expect(
      getMapDisplayImageCandidates('https://image.anitabi.cn/points/217249/db2c913d_1754363336601.jpg?w=640&q=80', { kind: 'point' }),
    ).toEqual([
      'https://seichigo.com/api/anitabi/image-render?url=https%253A%252F%252Fimage.anitabi.cn%252Fpoints%252F217249%252Fdb2c913d_1754363336601.jpg%253Fw%253D640%2526q%253D80',
      'https://seichigo.com/api/anitabi/image-render?url=https%253A%252F%252Fimage.anitabi.cn%252Fpoints%252F217249%252Fdb2c913d_1754363336601.jpg%253Fw%253D640%2526q%253D80&_retry=1',
    ])
  })

  it('adds a retry nonce when asked', () => {
    expect(toMapDisplayImageUrl('https://bgm.tv/cover.jpg', { kind: 'cover', retryNonce: 1 })).toBe(
      'https://seichigo.com/api/anitabi/image-render?url=https%253A%252F%252Fbgm.tv%252Fcover.jpg&_retry=1',
    )
  })

  it('adds diagnostic params only to render-proxy urls', () => {
    expect(
      appendMapImageDiagnosticParams(
        'https://seichigo.com/api/anitabi/image-render?url=https%253A%252F%252Fbgm.tv%252Fcover.jpg',
        { sessionId: 's1', chainId: 'c1', requestId: 'r1' },
      ),
    ).toContain('__mi_request=r1')

    expect(
      appendMapImageDiagnosticParams('https://image.anitabi.cn/bangumi/290980.jpg', {
        sessionId: 's1',
        chainId: 'c1',
        requestId: 'r1',
      }),
    ).toBe('https://image.anitabi.cn/bangumi/290980.jpg')
  })

  it('reads and strips diagnostic params', () => {
    const raw = 'https://seichigo.com/api/anitabi/image-render?url=https%253A%252F%252Fbgm.tv%252Fcover.jpg&__mi_session=s1&__mi_chain=c1&__mi_request=r1'

    expect(readMapImageDiagnosticParams(raw)).toEqual({
      sessionId: 's1',
      chainId: 'c1',
      requestId: 'r1',
    })
    expect(stripMapImageDiagnosticParams(raw).toString()).toBe(
      'https://seichigo.com/api/anitabi/image-render?url=https%253A%252F%252Fbgm.tv%252Fcover.jpg',
    )
  })
})

describe('normalizePointThumbnailUrl', () => {
  it('returns null for null input', () => {
    expect(normalizePointThumbnailUrl(null)).toBe(null)
  })

  it('returns null for undefined input', () => {
    expect(normalizePointThumbnailUrl(undefined)).toBe(null)
  })

  it('returns null for empty string', () => {
    expect(normalizePointThumbnailUrl('')).toBe(null)
    expect(normalizePointThumbnailUrl('   ')).toBe(null)
  })

  it('routes anitabi.cn thumbnail hosts through the render proxy', () => {
    const input = 'https://anitabi.cn/image.jpg'
    const result = normalizePointThumbnailUrl(input)
    expect(result).toBe('https://seichigo.com/api/anitabi/image-render?url=https%253A%252F%252Fimage.anitabi.cn%252Fimage.jpg%253Fplan%253Dh160')
  })

  it('routes subdomain anitabi hosts through the render proxy', () => {
    const input = 'https://cdn.anitabi.cn/image.jpg'
    const result = normalizePointThumbnailUrl(input)
    expect(result).toBe('https://seichigo.com/api/anitabi/image-render?url=https%253A%252F%252Fcdn.anitabi.cn%252Fimage.jpg%253Fplan%253Dh160')
  })

  it('preserves existing plan param when proxying anitabi host', () => {
    const input = 'https://anitabi.cn/image.jpg?plan=h160'
    const result = normalizePointThumbnailUrl(input)
    expect(result).toBe('https://seichigo.com/api/anitabi/image-render?url=https%253A%252F%252Fimage.anitabi.cn%252Fimage.jpg%253Fplan%253Dh160')
  })

  it('drops w and q params and proxies the normalized anitabi host', () => {
    const input = 'https://anitabi.cn/image.jpg?w=128&q=90'
    const result = normalizePointThumbnailUrl(input)
    expect(result).toBe('https://seichigo.com/api/anitabi/image-render?url=https%253A%252F%252Fimage.anitabi.cn%252Fimage.jpg%253Fplan%253Dh160')
  })

  it('preserves plan and drops resize params before proxying anitabi host', () => {
    const input = 'https://anitabi.cn/image.jpg?plan=h190&w=128&q=90'
    const result = normalizePointThumbnailUrl(input)
    expect(result).toBe('https://seichigo.com/api/anitabi/image-render?url=https%253A%252F%252Fimage.anitabi.cn%252Fimage.jpg%253Fplan%253Dh190')
  })

  it('rewrites www.anitabi.cn /images path before proxying', () => {
    const input = 'https://www.anitabi.cn/images/user/0/a.jpg?plan=h160'
    const result = normalizePointThumbnailUrl(input)
    expect(result).toBe('https://seichigo.com/api/anitabi/image-render?url=https%253A%252F%252Fimage.anitabi.cn%252Fuser%252F0%252Fa.jpg%253Fplan%253Dh160')
  })

  it('routes non-anitabi host thumbnails through the render proxy', () => {
    const input = 'https://example.com/image.jpg'
    const result = normalizePointThumbnailUrl(input)
    expect(result).toBe('https://seichigo.com/api/anitabi/image-render?url=https%253A%252F%252Fexample.com%252Fimage.jpg')
  })

  it('handles invalid URL gracefully by returning original string', () => {
    const input = 'not-a-valid-url'
    const result = normalizePointThumbnailUrl(input)
    expect(result).toBe('https://seichigo.com/not-a-valid-url')
  })

  it('handles relative URL by converting to absolute anitabi URL and proxying it', () => {
    const input = '/path/to/image.jpg'
    const result = normalizePointThumbnailUrl(input)
    expect(result).toBe('https://seichigo.com/api/anitabi/image-render?url=https%253A%252F%252Fimage.anitabi.cn%252Fpath%252Fto%252Fimage.jpg%253Fplan%253Dh160')
  })
})
