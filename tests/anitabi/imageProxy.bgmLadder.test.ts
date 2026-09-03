import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getMapDisplayImageCandidates, toCanvasSafeImageUrl } from '@/lib/anitabi/imageProxy'

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
      'https://seichigo.com/api/anitabi/image-render?url=https%253A%252F%252Flain.bgm.tv%252Fpic%252Fcover%252Fm%252Fb8%252F0d%252F513345_jv4wM.jpg',
    ])
  })

  it('adds proxy retry and direct bgm fallbacks for non-anitabi covers when the flag is on', () => {
    process.env[BGM_FALLBACK_FLAG] = '1'

    expect(
      getMapDisplayImageCandidates('https://lain.bgm.tv/pic/cover/l/b8/0d/513345_jv4wM.jpg', { kind: 'cover' }),
    ).toEqual([
      'https://seichigo.com/api/anitabi/image-render?url=https%253A%252F%252Flain.bgm.tv%252Fpic%252Fcover%252Fm%252Fb8%252F0d%252F513345_jv4wM.jpg',
      'https://seichigo.com/api/anitabi/image-render?url=https%253A%252F%252Flain.bgm.tv%252Fpic%252Fcover%252Fm%252Fb8%252F0d%252F513345_jv4wM.jpg&_retry=1',
      'https://lain.bgm.tv/pic/cover/m/b8/0d/513345_jv4wM.jpg',
    ])
  })

  it('keeps direct-safe anitabi covers on the direct-first ladder, direct pointing at the delivery host', () => {
    process.env[BGM_FALLBACK_FLAG] = '1'

    expect(
      getMapDisplayImageCandidates('https://www.anitabi.cn/bangumi/290980.jpg', { kind: 'cover' }),
    ).toEqual([
      // direct 一档已切到 EdgeOne 投递 host；proxy 一档保留 canonical host，由服务端再解析。
      'https://img-tc.anitabi.cn/bangumi/290980.jpg',
      'https://img-tc.anitabi.cn/bangumi/290980.jpg?_retry=1',
      'https://seichigo.com/api/anitabi/image-render?url=https%253A%252F%252Fimage.anitabi.cn%252Fbangumi%252F290980.jpg',
    ])
  })

  it('keeps point image kinds on the proxy-only ladder', () => {
    process.env[BGM_FALLBACK_FLAG] = '1'

    expect(
      getMapDisplayImageCandidates('https://image.anitabi.cn/points/217249/db2c913d_1754363336601.jpg?w=640&q=80', { kind: 'point' }),
    ).toEqual([
      'https://seichigo.com/api/anitabi/image-render?url=https%253A%252F%252Fimage.anitabi.cn%252Fpoints%252F217249%252Fdb2c913d_1754363336601.jpg%253Fw%253D640%2526q%253D80',
      'https://seichigo.com/api/anitabi/image-render?url=https%253A%252F%252Fimage.anitabi.cn%252Fpoints%252F217249%252Fdb2c913d_1754363336601.jpg%253Fw%253D640%2526q%253D80&_retry=1',
    ])
  })

  it('rewrites bgm-api relay covers onto the bgm proxy ladder with /l/ downgraded to /m/', () => {
    // bgm-api.anitabi.cn 全线 403：候选必须是 bgm.tv 风格（/l/→/m/、代理优先），
    // 不允许再出现直连 bgm-api 的档位。
    expect(
      getMapDisplayImageCandidates('https://bgm-api.anitabi.cn/pic/cover/l/18/af/495291_Qd97X.jpg', { kind: 'cover' }),
    ).toEqual([
      'https://seichigo.com/api/anitabi/image-render?url=https%3A%2F%2Flain.bgm.tv%2Fpic%2Fcover%2Fm%2F18%2Faf%2F495291_Qd97X.jpg',
    ])
  })

  it('strips the /img mount prefix from bgm-api relay covers on the flag-on ladder', () => {
    process.env[BGM_FALLBACK_FLAG] = '1'

    expect(
      getMapDisplayImageCandidates('https://bgm-api.anitabi.cn/img/pic/cover/l/a1/d3/325767_u3pvR.jpg', { kind: 'cover' }),
    ).toEqual([
      'https://seichigo.com/api/anitabi/image-render?url=https%3A%2F%2Flain.bgm.tv%2Fpic%2Fcover%2Fm%2Fa1%2Fd3%2F325767_u3pvR.jpg',
      'https://seichigo.com/api/anitabi/image-render?url=https%3A%2F%2Flain.bgm.tv%2Fpic%2Fcover%2Fm%2Fa1%2Fd3%2F325767_u3pvR.jpg&_retry=1',
      'https://lain.bgm.tv/pic/cover/m/a1/d3/325767_u3pvR.jpg',
    ])
  })

  it('routes bgm-api relay covers through the proxy in canvas-safe urls', () => {
    expect(
      toCanvasSafeImageUrl('https://bgm-api.anitabi.cn/pic/cover/l/18/af/495291_Qd97X.jpg'),
    ).toBe(
      'https://seichigo.com/api/anitabi/image-render?url=https%3A%2F%2Flain.bgm.tv%2Fpic%2Fcover%2Fl%2F18%2Faf%2F495291_Qd97X.jpg',
    )
  })

  it('rewrites direct-safe anitabi hosts onto the delivery host in canvas-safe urls', () => {
    // image.anitabi.cn 直连 403：canvas 安全 URL 不再直连 canonical host，切到投递 host。
    expect(
      toCanvasSafeImageUrl('https://image.anitabi.cn/ptheme/anitabi/full/sprite.webp'),
    ).toBe('https://img-tc.anitabi.cn/ptheme/anitabi/full/sprite.webp')
  })
})
