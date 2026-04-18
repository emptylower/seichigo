import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { normalizePointThumbnailUrl } from '@/components/map/utils/normalizePointThumbnailUrl'
import { getMapDisplayImageCandidates, toCanvasSafeImageUrl, toMapDisplayImageUrl } from '@/lib/anitabi/imageProxy'

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
      'https://seichigo.com/api/anitabi/image-render?url=https%3A%2F%2Fbgm.tv%2Fcover.jpg',
    )
  })

  it('keeps image.anitabi.cn assets direct because they are CORS-friendly', () => {
    expect(toCanvasSafeImageUrl('https://image.anitabi.cn/bangumi/290980.jpg')).toBe(
      'https://image.anitabi.cn/bangumi/290980.jpg',
    )
  })

  it('does not include name in the render proxy url', () => {
    const fooUrl = toCanvasSafeImageUrl('https://bgm.tv/cover.jpg', 'foo-name')
    const barUrl = toCanvasSafeImageUrl('https://bgm.tv/cover.jpg', 'bar-name')

    expect(fooUrl).toBe('https://seichigo.com/api/anitabi/image-render?url=https%3A%2F%2Fbgm.tv%2Fcover.jpg')
    expect(barUrl).toBe(fooUrl)
    expect(fooUrl).not.toContain('name=')
  })
})

describe('toMapDisplayImageUrl', () => {
  it('rewrites bgm cover urls to medium size for cover displays', () => {
    expect(toMapDisplayImageUrl('https://lain.bgm.tv/pic/cover/l/b8/0d/513345_jv4wM.jpg', { kind: 'cover' })).toBe(
      'https://seichigo.com/api/anitabi/image-render?url=https%3A%2F%2Flain.bgm.tv%2Fpic%2Fcover%2Fm%2Fb8%2F0d%2F513345_jv4wM.jpg',
    )
  })

  it('keeps anitabi point images direct and requests a smaller display plan', () => {
    expect(toMapDisplayImageUrl('https://www.anitabi.cn/images/user/0/a.jpg', { kind: 'point' })).toBe(
      'https://image.anitabi.cn/user/0/a.jpg?plan=h320',
    )
  })

  it('keeps anitabi point-photo paths direct and uses width-based resizing instead of an unsupported display plan', () => {
    expect(
      toMapDisplayImageUrl('https://image.anitabi.cn/points/217249/db2c913d_1754363336601.jpg?w=640&q=80', { kind: 'point' }),
    ).toBe(
      'https://image.anitabi.cn/points/217249/db2c913d_1754363336601.jpg?w=640&q=80',
    )
  })

  it('uses a smaller direct plan for point thumbnail displays', () => {
    expect(toMapDisplayImageUrl('https://www.anitabi.cn/images/user/0/a.jpg', { kind: 'point-thumbnail' })).toBe(
      'https://image.anitabi.cn/user/0/a.jpg?plan=h160',
    )
  })

  it('prefers direct image.anitabi.cn bangumi covers with proxy fallback candidates', () => {
    expect(getMapDisplayImageCandidates('https://www.anitabi.cn/bangumi/290980.jpg', { kind: 'cover' })).toEqual([
      'https://image.anitabi.cn/bangumi/290980.jpg',
      'https://image.anitabi.cn/bangumi/290980.jpg?_retry=1',
      'https://seichigo.com/api/anitabi/image-render?url=https%3A%2F%2Fimage.anitabi.cn%2Fbangumi%2F290980.jpg',
    ])
    expect(toMapDisplayImageUrl('https://www.anitabi.cn/bangumi/290980.jpg', { kind: 'cover' })).toBe(
      'https://image.anitabi.cn/bangumi/290980.jpg',
    )
  })

  it('prefers direct point-photo urls with retry and proxy fallback candidates', () => {
    expect(
      getMapDisplayImageCandidates('https://image.anitabi.cn/points/217249/db2c913d_1754363336601.jpg?w=640&q=80', { kind: 'point' }),
    ).toEqual([
      'https://image.anitabi.cn/points/217249/db2c913d_1754363336601.jpg?w=640&q=80',
      'https://image.anitabi.cn/points/217249/db2c913d_1754363336601.jpg?w=640&q=80&_retry=1',
      'https://seichigo.com/api/anitabi/image-render?url=https%3A%2F%2Fimage.anitabi.cn%2Fpoints%2F217249%2Fdb2c913d_1754363336601.jpg%3Fw%3D640%26q%3D80',
    ])
  })

  it('adds a retry nonce when asked', () => {
    expect(toMapDisplayImageUrl('https://bgm.tv/cover.jpg', { kind: 'cover', retryNonce: 1 })).toBe(
      'https://seichigo.com/api/anitabi/image-render?url=https%3A%2F%2Fbgm.tv%2Fcover.jpg&_retry=1',
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

  it('returns URL with plan=h160 for anitabi.cn host', () => {
    const input = 'https://anitabi.cn/image.jpg'
    const result = normalizePointThumbnailUrl(input)
    expect(result).toBe('https://image.anitabi.cn/image.jpg?plan=h160')
  })

  it('returns URL with plan=h160 for subdomain.anitabi.cn host', () => {
    const input = 'https://cdn.anitabi.cn/image.jpg'
    const result = normalizePointThumbnailUrl(input)
    expect(result).toBe('https://cdn.anitabi.cn/image.jpg?plan=h160')
  })

  it('preserves existing plan param for anitabi host', () => {
    const input = 'https://anitabi.cn/image.jpg?plan=h160'
    const result = normalizePointThumbnailUrl(input)
    expect(result).toBe('https://image.anitabi.cn/image.jpg?plan=h160')
  })

  it('drops w and q params and forces plan for anitabi host', () => {
    const input = 'https://anitabi.cn/image.jpg?w=128&q=90'
    const result = normalizePointThumbnailUrl(input)
    expect(result).toBe('https://image.anitabi.cn/image.jpg?plan=h160')
  })

  it('preserves plan and drops resize params for anitabi host', () => {
    const input = 'https://anitabi.cn/image.jpg?plan=h320&w=128&q=90'
    const result = normalizePointThumbnailUrl(input)
    expect(result).toBe('https://image.anitabi.cn/image.jpg?plan=h320')
  })

  it('rewrites www.anitabi.cn /images path to image.anitabi.cn', () => {
    const input = 'https://www.anitabi.cn/images/user/0/a.jpg?plan=h160'
    const result = normalizePointThumbnailUrl(input)
    expect(result).toBe('https://image.anitabi.cn/user/0/a.jpg?plan=h160')
  })

  it('routes non-anitabi host thumbnails through the render proxy', () => {
    const input = 'https://example.com/image.jpg'
    const result = normalizePointThumbnailUrl(input)
    expect(result).toBe('https://seichigo.com/api/anitabi/image-render?url=https%3A%2F%2Fexample.com%2Fimage.jpg')
  })

  it('handles invalid URL gracefully by returning original string', () => {
    const input = 'not-a-valid-url'
    const result = normalizePointThumbnailUrl(input)
    // URL constructor with base converts relative paths to absolute
    expect(result).toBe('https://seichigo.com/not-a-valid-url')
  })

  it('handles relative URL by converting to absolute anitabi URL', () => {
    const input = '/path/to/image.jpg'
    const result = normalizePointThumbnailUrl(input)
    expect(result).toBe('https://image.anitabi.cn/path/to/image.jpg?plan=h160')
  })
})
