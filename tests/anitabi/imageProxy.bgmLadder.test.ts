import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getMapDisplayImageCandidates } from '@/lib/anitabi/imageProxy'

const BGM_FALLBACK_FLAG = 'NEXT_PUBLIC_MAP_IMAGE_LADDER_BGM_FALLBACK_ENABLED'
const originalWindow = globalThis.window
const originalBgmFallbackFlag = process.env[BGM_FALLBACK_FLAG]

describe('getMapDisplayImageCandidates bgm cover ladder', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'window', {
      value: {
        location: {
          origin: 'https://seichigo.com',
        },
      },
      configurable: true,
    })
    delete process.env[BGM_FALLBACK_FLAG]
  })

  afterEach(() => {
    if (originalWindow) {
      Object.defineProperty(globalThis, 'window', {
        value: originalWindow,
        configurable: true,
      })
    } else {
      Reflect.deleteProperty(globalThis, 'window')
    }

    if (originalBgmFallbackFlag === undefined) {
      delete process.env[BGM_FALLBACK_FLAG]
      return
    }
    process.env[BGM_FALLBACK_FLAG] = originalBgmFallbackFlag
  })

  it('keeps non-anitabi covers on the single proxy candidate when the flag is off', () => {
    expect(
      getMapDisplayImageCandidates('https://lain.bgm.tv/pic/cover/l/b8/0d/513345_jv4wM.jpg', { kind: 'cover' }),
    ).toEqual([
      'https://seichigo.com/api/anitabi/image-render?url=https%3A%2F%2Flain.bgm.tv%2Fpic%2Fcover%2Fm%2Fb8%2F0d%2F513345_jv4wM.jpg',
    ])
  })

  it('adds proxy retry and direct bgm fallbacks for non-anitabi covers when the flag is on', () => {
    process.env[BGM_FALLBACK_FLAG] = '1'

    expect(
      getMapDisplayImageCandidates('https://lain.bgm.tv/pic/cover/l/b8/0d/513345_jv4wM.jpg', { kind: 'cover' }),
    ).toEqual([
      'https://seichigo.com/api/anitabi/image-render?url=https%3A%2F%2Flain.bgm.tv%2Fpic%2Fcover%2Fm%2Fb8%2F0d%2F513345_jv4wM.jpg',
      'https://seichigo.com/api/anitabi/image-render?url=https%3A%2F%2Flain.bgm.tv%2Fpic%2Fcover%2Fm%2Fb8%2F0d%2F513345_jv4wM.jpg&_retry=1',
      'https://lain.bgm.tv/pic/cover/m/b8/0d/513345_jv4wM.jpg',
    ])
  })

  it('keeps direct-safe anitabi covers on the direct-first ladder', () => {
    process.env[BGM_FALLBACK_FLAG] = '1'

    expect(
      getMapDisplayImageCandidates('https://www.anitabi.cn/bangumi/290980.jpg', { kind: 'cover' }),
    ).toEqual([
      'https://image.anitabi.cn/bangumi/290980.jpg',
      'https://image.anitabi.cn/bangumi/290980.jpg?_retry=1',
      'https://seichigo.com/api/anitabi/image-render?url=https%3A%2F%2Fimage.anitabi.cn%2Fbangumi%2F290980.jpg',
    ])
  })

  it('keeps point image kinds on the proxy-only ladder', () => {
    process.env[BGM_FALLBACK_FLAG] = '1'

    expect(
      getMapDisplayImageCandidates('https://image.anitabi.cn/points/217249/db2c913d_1754363336601.jpg?w=640&q=80', { kind: 'point' }),
    ).toEqual([
      'https://seichigo.com/api/anitabi/image-render?url=https%3A%2F%2Fimage.anitabi.cn%2Fpoints%2F217249%2Fdb2c913d_1754363336601.jpg%3Fw%3D640%26q%3D80',
      'https://seichigo.com/api/anitabi/image-render?url=https%3A%2F%2Fimage.anitabi.cn%2Fpoints%2F217249%2Fdb2c913d_1754363336601.jpg%3Fw%3D640%26q%3D80&_retry=1',
    ])
  })
})
