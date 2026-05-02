import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  readMapImageEffectiveHost,
  readMapImageUpstreamHost,
} from '@/components/map/utils/mapImageHostPolicy'

const PROXY_AWARE_FLAG = 'NEXT_PUBLIC_MAP_IMAGE_HOST_POLICY_PROXY_AWARE'

describe('readMapImageUpstreamHost', () => {
  it('extracts upstream host from a proxy URL', () => {
    const proxyUrl = 'https://www.seichigo.com/api/anitabi/image-render?url=https%3A%2F%2Fimage.anitabi.cn%2Fbangumi%2F405785.jpg'
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

describe('readMapImageEffectiveHost', () => {
  const originalFlag = process.env[PROXY_AWARE_FLAG]

  beforeEach(() => {
    delete process.env[PROXY_AWARE_FLAG]
  })

  afterEach(() => {
    if (originalFlag === undefined) {
      delete process.env[PROXY_AWARE_FLAG]
      return
    }
    process.env[PROXY_AWARE_FLAG] = originalFlag
  })

  it('returns own host for direct URLs regardless of flag', () => {
    expect(readMapImageEffectiveHost('https://image.anitabi.cn/bangumi/1.jpg')).toBe('image.anitabi.cn')
    process.env[PROXY_AWARE_FLAG] = '1'
    expect(readMapImageEffectiveHost('https://image.anitabi.cn/bangumi/1.jpg')).toBe('image.anitabi.cn')
  })

  it('returns proxy host (not upstream) when flag is OFF', () => {
    const proxyUrl = 'https://www.seichigo.com/api/anitabi/image-render?url=https%3A%2F%2Fimage.anitabi.cn%2Fbangumi%2F1.jpg'
    expect(readMapImageEffectiveHost(proxyUrl)).toBe('www.seichigo.com')
  })

  it('returns upstream host when flag is ON for proxy URLs', () => {
    process.env[PROXY_AWARE_FLAG] = '1'
    const proxyUrl = 'https://www.seichigo.com/api/anitabi/image-render?url=https%3A%2F%2Flain.bgm.tv%2Fpic%2Fcover%2Fm%2F513345.jpg'
    expect(readMapImageEffectiveHost(proxyUrl)).toBe('lain.bgm.tv')
  })

  it('falls back to proxy host when upstream extraction fails (flag ON)', () => {
    process.env[PROXY_AWARE_FLAG] = '1'
    const proxyUrl = 'https://www.seichigo.com/api/anitabi/image-render?url=garbage'
    expect(readMapImageEffectiveHost(proxyUrl)).toBe('www.seichigo.com')
  })

  it('falls back to proxy host when proxy URL is missing url param (flag ON)', () => {
    process.env[PROXY_AWARE_FLAG] = '1'
    const proxyUrl = 'https://www.seichigo.com/api/anitabi/image-render'
    expect(readMapImageEffectiveHost(proxyUrl)).toBe('www.seichigo.com')
  })
})
