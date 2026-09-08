import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  getMapDisplayImageCandidates,
  getMapDisplayImageCandidatesAsync,
  resolveMirrorPublicUrl,
  toMapDisplayImageUrlAsync,
} from '@/lib/anitabi/imageProxy'

const R2_BASE_FLAG = 'NEXT_PUBLIC_MAP_IMAGE_R2_PUBLIC_BASE'
const R2_BASE = 'https://img.seichigo.com'
const originalWindow = globalThis.window
const originalR2BaseFlag = process.env[R2_BASE_FLAG]

async function sha256Hex24(input: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 24)
}

function decodeProxyTarget(candidate: string): string {
  return decodeURIComponent(new URL(candidate).searchParams.get('url') || '')
}

describe('getMapDisplayImageCandidatesAsync R2 public base', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'window', {
      value: {
        location: {
          origin: 'https://seichigo.com',
        },
      },
      configurable: true,
    })
    delete process.env[R2_BASE_FLAG]
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

    if (originalR2BaseFlag === undefined) {
      delete process.env[R2_BASE_FLAG]
      return
    }
    process.env[R2_BASE_FLAG] = originalR2BaseFlag
  })

  it('flag off: async output identical to the legacy sync ladder', async () => {
    const pointRaw = 'https://image.anitabi.cn/points/217249/db2c913d_1754363336601.jpg?w=640&q=80'
    const coverRaw = 'https://lain.bgm.tv/pic/cover/l/b8/0d/513345_jv4wM.jpg'
    const thumbRaw = 'https://image.anitabi.cn/points/38125/y.jpg'

    for (const [raw, kind] of [
      [pointRaw, 'point'],
      [coverRaw, 'cover'],
      [thumbRaw, 'point-thumbnail'],
    ] as const) {
      expect(await getMapDisplayImageCandidatesAsync(raw, { kind })).toEqual(
        getMapDisplayImageCandidates(raw, { kind }),
      )
    }

    // 点位 kind 保持纯代理两档（旧行为，无 R2 首档、无直连尾档）
    expect(getMapDisplayImageCandidates(pointRaw, { kind: 'point' })).toHaveLength(2)
  })

  it('flag on: point ladder is [r2, proxy, proxy retry, direct delivery]', async () => {
    process.env[R2_BASE_FLAG] = R2_BASE
    const raw = 'https://image.anitabi.cn/points/38125/y.jpg'
    const canonical = 'https://image.anitabi.cn/points/38125/y.jpg?q=80&w=640'
    const hash = await sha256Hex24(canonical)

    const candidates = await getMapDisplayImageCandidatesAsync(raw, { kind: 'point' })

    expect(candidates).toHaveLength(4)
    // 首项：R2 直出（host 段 / 24-hex / 扩展名与 mirror key 零漂移；hash 输入是排序后的 canonical）
    expect(candidates[0]).toBe(`${R2_BASE}/mirror/v1/image.anitabi.cn/${hash}/.jpg`)
    // 第二项：站内代理，上游为 w=640&q=80 变体（参数保持变体顺序，未排序）
    expect(candidates[1]!.startsWith('https://seichigo.com/api/anitabi/image-render?url=')).toBe(true)
    expect(decodeProxyTarget(candidates[1]!)).toBe('https://image.anitabi.cn/points/38125/y.jpg?w=640&q=80')
    // 第三项：代理重试
    expect(candidates[2]).toBe(`${candidates[1]}&_retry=1`)
    // 末项：直连投递（EdgeOne host，最终兜底）
    expect(candidates[3]).toBe('https://img-tc.anitabi.cn/points/38125/y.jpg?w=640&q=80')
  })

  it('flag on: point-thumbnail ladder uses the h160 mirror variant first', async () => {
    process.env[R2_BASE_FLAG] = R2_BASE
    const raw = 'https://image.anitabi.cn/points/38125/y.jpg'
    const canonical = 'https://image.anitabi.cn/points/38125/y.jpg?plan=h160'
    const hash = await sha256Hex24(canonical)

    const candidates = await getMapDisplayImageCandidatesAsync(raw, { kind: 'point-thumbnail' })

    expect(candidates[0]).toBe(`${R2_BASE}/mirror/v1/image.anitabi.cn/${hash}/.jpg`)
    expect(decodeProxyTarget(candidates[1]!)).toBe('https://image.anitabi.cn/points/38125/y.jpg?plan=h160')
  })

  it('flag on: bgm cover gets the R2 direct url first and keeps the proxy ladder', async () => {
    process.env[R2_BASE_FLAG] = R2_BASE
    const raw = 'https://lain.bgm.tv/pic/cover/l/b8/0d/513345_jv4wM.jpg'
    const canonical = 'https://lain.bgm.tv/pic/cover/m/b8/0d/513345_jv4wM.jpg'
    const hash = await sha256Hex24(canonical)

    const candidates = await getMapDisplayImageCandidatesAsync(raw, { kind: 'cover' })

    expect(candidates[0]).toBe(`${R2_BASE}/mirror/v1/lain.bgm.tv/${hash}/.jpg`)
    expect(candidates.slice(1)).toEqual(getMapDisplayImageCandidates(raw, { kind: 'cover' }))
  })

  it('flag on: .png point images map to a .png mirror key', async () => {
    process.env[R2_BASE_FLAG] = R2_BASE
    const raw = 'https://image.anitabi.cn/points/1/p.png'
    const canonical = 'https://image.anitabi.cn/points/1/p.png?q=80&w=640'
    const hash = await sha256Hex24(canonical)

    expect(await resolveMirrorPublicUrl(raw, { kind: 'point' })).toBe(
      `${R2_BASE}/mirror/v1/image.anitabi.cn/${hash}/.png`,
    )
  })

  it('flag on: same-origin and non-mirrored hosts get no R2 candidate', async () => {
    process.env[R2_BASE_FLAG] = R2_BASE

    // 站内 origin：仍是单候选直出，不插 R2
    expect(await getMapDisplayImageCandidatesAsync('https://seichigo.com/images/cover.jpg', { kind: 'cover' }))
      .toEqual(['https://seichigo.com/images/cover.jpg'])

    // 非 anitabi/bgm 域：无 mirror 候选，点位梯也只到代理两档（无直连尾档）
    expect(await resolveMirrorPublicUrl('https://example.com/x.jpg', { kind: 'point' })).toBeNull()
    const candidates = await getMapDisplayImageCandidatesAsync('https://example.com/x.jpg', { kind: 'point' })
    expect(candidates).toHaveLength(2)
    expect(candidates[0]!.startsWith('https://seichigo.com/api/anitabi/image-render?url=')).toBe(true)
  })

  it('flag on: toMapDisplayImageUrlAsync returns the R2 url as the primary display url', async () => {
    process.env[R2_BASE_FLAG] = R2_BASE
    const canonical = 'https://image.anitabi.cn/points/38125/y.jpg?plan=h160'
    const hash = await sha256Hex24(canonical)

    expect(await toMapDisplayImageUrlAsync('https://image.anitabi.cn/points/38125/y.jpg', { kind: 'point-thumbnail' }))
      .toBe(`${R2_BASE}/mirror/v1/image.anitabi.cn/${hash}/.jpg`)
  })
})
