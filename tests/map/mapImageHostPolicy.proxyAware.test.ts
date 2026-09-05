import { describe, expect, it } from 'vitest'
import {
  isMapImageProxyUrl,
  readMapImageEffectiveHost,
  readMapImageUpstreamHost,
} from '@/components/map/utils/mapImageHostPolicy'

describe('isMapImageProxyUrl', () => {
  it('isMapImageProxyUrl 识别 anitabi 与 google 代理', () => {
    expect(isMapImageProxyUrl('/api/anitabi/image-render?url=x')).toBe(true)
    expect(isMapImageProxyUrl('https://seichigo.com/api/google/place-photo?placeId=ChIJabc')).toBe(true)
    expect(isMapImageProxyUrl('/api/google/place-photo?placeId=ChIJ3RpcnUUgdV8R9oH25Xxguho&maxwidth=1600')).toBe(true)
    expect(isMapImageProxyUrl('https://image.anitabi.cn/a.jpg')).toBe(false)
  })

  it('isMapImageProxyUrl 识别 google point-photo 点位兜底接口', () => {
    expect(isMapImageProxyUrl('/api/google/point-photo?pointId=115908%3Auji&maxwidth=400')).toBe(true)
    expect(isMapImageProxyUrl('https://seichigo.com/api/google/point-photo?pointId=x')).toBe(true)
  })
})

describe('readMapImageUpstreamHost', () => {
  it('returns null for google place-photo proxy URLs (no upstream host concept)', () => {
    expect(readMapImageUpstreamHost('/api/google/place-photo?placeId=ChIJabc&maxwidth=1600')).toBe(null)
  })

  it('extracts upstream host from a proxy URL', () => {
    const proxyUrl = 'https://www.seichigo.com/api/anitabi/image-render?url=https%3A%2F%2Fimage.anitabi.cn%2Fbangumi%2F405785.jpg'
    expect(readMapImageUpstreamHost(proxyUrl)).toBe('image.anitabi.cn')
  })

  it('extracts upstream host from a double-encoded proxy URL (E2 客户端双重编码)', () => {
    const proxyUrl = 'https://www.seichigo.com/api/anitabi/image-render?url=https%253A%252F%252Fimage.anitabi.cn%252Fpoints%252F217249%252Fa.jpg%253Fw%253D640%2526q%253D80'
    expect(readMapImageUpstreamHost(proxyUrl)).toBe('image.anitabi.cn')
  })

  it('extracts upstream host even when proxy URL has additional __mi_ params', () => {
    const proxyUrl = 'https://www.seichigo.com/api/anitabi/image-render?url=https%3A%2F%2Flain.bgm.tv%2Fpic%2Fcover%2Fm%2F513345.jpg&__mi_session=foo&__mi_sampled=1'
    expect(readMapImageUpstreamHost(proxyUrl)).toBe('lain.bgm.tv')
  })

  it('returns null for non-proxy URLs', () => {
    expect(readMapImageUpstreamHost('https://image.anitabi.cn/bangumi/1.jpg')).toBe(null)
    expect(readMapImageUpstreamHost('https://lain.bgm.tv/pic/cover/m/x.jpg')).toBe(null)
  })

  it('returns null for proxy URL missing url query parameter', () => {
    expect(readMapImageUpstreamHost('https://www.seichigo.com/api/anitabi/image-render')).toBe(null)
    expect(readMapImageUpstreamHost('https://www.seichigo.com/api/anitabi/image-render?other=foo')).toBe(null)
  })

  it('returns null for proxy URL with malformed url query parameter', () => {
    const proxyUrl = 'https://www.seichigo.com/api/anitabi/image-render?url=not-a-valid-url'
    expect(readMapImageUpstreamHost(proxyUrl)).toBe(null)
  })

  it('returns null for unrelated same-origin paths', () => {
    expect(readMapImageUpstreamHost('https://www.seichigo.com/some/other/path?url=https%3A%2F%2Fimage.anitabi.cn%2F')).toBe(null)
  })

  it('lowercases the upstream host', () => {
    const proxyUrl = 'https://www.seichigo.com/api/anitabi/image-render?url=HTTPS%3A%2F%2FIMAGE.Anitabi.CN%2Fbangumi%2F1.jpg'
    expect(readMapImageUpstreamHost(proxyUrl)).toBe('image.anitabi.cn')
  })
})

describe('readMapImageEffectiveHost（代理恒按上游标识记账，无开关）', () => {
  it('returns own host for direct URLs', () => {
    expect(readMapImageEffectiveHost('https://image.anitabi.cn/bangumi/1.jpg')).toBe('image.anitabi.cn')
  })

  it('anitabi 代理 URL 恒返回上游 host，绝不退化成站点 host', () => {
    const proxyUrl = 'https://www.seichigo.com/api/anitabi/image-render?url=https%3A%2F%2Flain.bgm.tv%2Fpic%2Fcover%2Fm%2F513345.jpg'
    expect(readMapImageEffectiveHost(proxyUrl)).toBe('lain.bgm.tv')
  })

  it('google place-photo 代理 URL 返回固定标识 google-place-photo', () => {
    expect(readMapImageEffectiveHost('/api/google/place-photo?placeId=ChIJabc&maxwidth=1600')).toBe('google-place-photo')
    expect(
      readMapImageEffectiveHost('https://www.seichigo.com/api/google/place-photo?placeId=ChIJabc'),
    ).toBe('google-place-photo')
  })

  it('google point-photo 代理 URL 返回固定标识 google-point-photo', () => {
    expect(readMapImageEffectiveHost('/api/google/point-photo?pointId=115908%3Auji&maxwidth=400')).toBe(
      'google-point-photo',
    )
    expect(readMapImageEffectiveHost('https://www.seichigo.com/api/google/point-photo?pointId=x')).toBe(
      'google-point-photo',
    )
  })

  it('falls back to proxy host when upstream extraction fails', () => {
    const proxyUrl = 'https://www.seichigo.com/api/anitabi/image-render?url=garbage'
    expect(readMapImageEffectiveHost(proxyUrl)).toBe('www.seichigo.com')
  })

  it('falls back to proxy host when proxy URL is missing url param', () => {
    const proxyUrl = 'https://www.seichigo.com/api/anitabi/image-render'
    expect(readMapImageEffectiveHost(proxyUrl)).toBe('www.seichigo.com')
  })
})
