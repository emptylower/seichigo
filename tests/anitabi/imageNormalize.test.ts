import { afterEach, describe, expect, it } from 'vitest'
import {
  computeCanonicalImageUrl,
  computeMirrorKey,
  normalizeBgmApiRelayUrl,
  resolveAnitabiDeliveryUrl,
} from '@/lib/anitabi/imageNormalize'

describe('bgm-api relay rewrite (2026-08-31 cover incident)', () => {
  it('rewrites the relay host to lain.bgm.tv keeping path and query intact', () => {
    expect(
      normalizeBgmApiRelayUrl('https://bgm-api.anitabi.cn/pic/cover/l/18/af/495291_Qd97X.jpg?t=2').toString(),
    ).toBe('https://lain.bgm.tv/pic/cover/l/18/af/495291_Qd97X.jpg?t=2')
  })

  it('strips the /img mount prefix from /img/pic relay paths', () => {
    expect(
      normalizeBgmApiRelayUrl('https://bgm-api.anitabi.cn/img/pic/cover/l/a1/d3/325767_u3pvR.jpg').toString(),
    ).toBe('https://lain.bgm.tv/pic/cover/l/a1/d3/325767_u3pvR.jpg')
  })

  it('matches the relay host case-insensitively', () => {
    expect(normalizeBgmApiRelayUrl('https://BGM-API.ANITABI.CN/pic/a.jpg').toString()).toBe(
      'https://lain.bgm.tv/pic/a.jpg',
    )
  })

  it('passes non-bgm-api hosts through unchanged without mutating the input', () => {
    const input = new URL('https://img-tc.anitabi.cn/points/1/photo.jpg?plan=h320')
    const output = normalizeBgmApiRelayUrl(input)
    expect(output.toString()).toBe('https://img-tc.anitabi.cn/points/1/photo.jpg?plan=h320')
    expect(output).not.toBe(input)
    expect(input.hostname).toBe('img-tc.anitabi.cn')
  })

  it('maps bgm-api covers to the same canonical as the lain.bgm.tv source (zero mirror key drift)', async () => {
    const viaRelay = computeCanonicalImageUrl('https://bgm-api.anitabi.cn/pic/cover/l/18/af/495291_Qd97X.jpg')
    const viaImgRelay = computeCanonicalImageUrl('https://bgm-api.anitabi.cn/img/pic/cover/l/18/af/495291_Qd97X.jpg')
    const viaOrigin = computeCanonicalImageUrl('https://lain.bgm.tv/pic/cover/l/18/af/495291_Qd97X.jpg')

    // 三入口 canonical 必须一致 —— 这是 R2 旧镜像 key 零漂移、兜底可命中的前提。
    expect(viaOrigin).toBe('https://lain.bgm.tv/pic/cover/m/18/af/495291_Qd97X.jpg')
    expect(viaRelay).toBe(viaOrigin)
    expect(viaImgRelay).toBe(viaOrigin)

    const keyViaRelay = await computeMirrorKey(viaRelay, 'image/jpeg')
    const keyViaOrigin = await computeMirrorKey(viaOrigin, 'image/jpeg')
    expect(keyViaRelay).toBe(keyViaOrigin)
  })
})

describe('anitabi image normalization', () => {
  it('rewrites anitabi image hosts and strips the /images prefix', () => {
    expect(
      computeCanonicalImageUrl('https://anitabi.cn/images/bangumi/123/cover.jpg?plan=h320'),
    ).toBe('https://image.anitabi.cn/bangumi/123/cover.jpg?plan=h320')
  })

  it('collapses bgm cover variants from /l/ to /m/', () => {
    expect(
      computeCanonicalImageUrl('https://lain.bgm.tv/pic/cover/l/b8/0d/513345_jv4wM.jpg'),
    ).toBe('https://lain.bgm.tv/pic/cover/m/b8/0d/513345_jv4wM.jpg')
  })

  it('strips diagnostic parameters, retry markers, and name while sorting remaining params', () => {
    expect(
      computeCanonicalImageUrl(
        'https://image.anitabi.cn/points/1/photo.jpg?z=9&__mi_session=s1&_retry=2&name=cover&w=640&__mi_chain=c1&q=80&plan=h320&__mi_request=r1',
      ),
    ).toBe('https://image.anitabi.cn/points/1/photo.jpg?plan=h320&q=80&w=640&z=9')
  })

  it('treats reordered query strings as the same canonical URL', () => {
    const first = computeCanonicalImageUrl(
      'https://image.anitabi.cn/points/1/photo.jpg?plan=h320&q=80&w=640&z=9',
    )
    const second = computeCanonicalImageUrl(
      'https://image.anitabi.cn/points/1/photo.jpg?z=9&w=640&plan=h320&q=80',
    )

    expect(first).toBe(second)
  })

  it('lowercases protocol and host in the canonical output', () => {
    expect(
      computeCanonicalImageUrl('HTTPS://WWW.ANITABI.CN/images/bangumi/123/cover.jpg?plan=h320'),
    ).toBe('https://image.anitabi.cn/bangumi/123/cover.jpg?plan=h320')
  })

  it('rejects relative URLs for mirror canonicalization', () => {
    expect(() => computeCanonicalImageUrl('/images/bangumi/123/cover.jpg?plan=h320')).toThrow('invalid_image_url')
  })

  it('rejects unsupported URL schemes for mirror canonicalization', () => {
    expect(() => computeCanonicalImageUrl('ftp://anitabi.cn/images/bangumi/123/cover.jpg')).toThrow('invalid_image_url')
  })

  it('rejects empty inputs for mirror canonicalization', () => {
    expect(() => computeCanonicalImageUrl('   ')).toThrow('invalid_image_url')
  })
})

describe('anitabi delivery host switching (WS1)', () => {
  const ENV_KEY = 'NEXT_PUBLIC_ANITABI_IMAGE_HOST'

  afterEach(() => {
    delete process.env[ENV_KEY]
  })

  it('resolves anitabi image URLs to the EdgeOne host by default', () => {
    expect(
      resolveAnitabiDeliveryUrl('https://image.anitabi.cn/points/1/photo.jpg?plan=h320').toString(),
    ).toBe('https://img-tc.anitabi.cn/points/1/photo.jpg?plan=h320')
  })

  it('resolves an already-canonical www-normalized URL to the delivery host', () => {
    // normalizeAnitabiMirrorUrl 先把 www.anitabi.cn/images/X 归一成 image.anitabi.cn/X，
    // resolveAnitabiDeliveryUrl 再把 image host 换成投递 host。两步串联后：
    const canonical = computeCanonicalImageUrl('https://www.anitabi.cn/images/user/0/a.jpg?plan=h160')
    expect(canonical).toBe('https://image.anitabi.cn/user/0/a.jpg?plan=h160')
    expect(resolveAnitabiDeliveryUrl(canonical).toString()).toBe(
      'https://img-tc.anitabi.cn/user/0/a.jpg?plan=h160',
    )
  })

  it('passes www host through unchanged (normalizeAnitabiMirrorUrl owns that rewrite)', () => {
    // www 不在投递 host 集合里 —— 它先被归一到 image.anitabi.cn，再换投递 host。
    expect(
      resolveAnitabiDeliveryUrl('https://www.anitabi.cn/images/user/0/a.jpg').toString(),
    ).toBe('https://www.anitabi.cn/images/user/0/a.jpg')
  })

  it('honours the NEXT_PUBLIC_ANITABI_IMAGE_HOST override for rollback', () => {
    process.env[ENV_KEY] = 'image.anitabi.cn'
    expect(
      resolveAnitabiDeliveryUrl('https://image.anitabi.cn/points/1/photo.jpg').toString(),
    ).toBe('https://image.anitabi.cn/points/1/photo.jpg')
  })

  it('ignores unknown override values and falls back to EdgeOne', () => {
    process.env[ENV_KEY] = 'evil.example.com'
    expect(
      resolveAnitabiDeliveryUrl('https://image.anitabi.cn/points/1/photo.jpg').toString(),
    ).toBe('https://img-tc.anitabi.cn/points/1/photo.jpg')
  })

  it('leaves non-anitabi hosts untouched', () => {
    const bgm = 'https://lain.bgm.tv/pic/cover/m/b8/0d/513345_jv4wM.jpg'
    expect(resolveAnitabiDeliveryUrl(bgm).toString()).toBe(bgm)
  })

  it('normalizes the img-tc host back to the canonical host', () => {
    expect(
      computeCanonicalImageUrl('https://img-tc.anitabi.cn/points/1/photo.jpg?plan=h320'),
    ).toBe('https://image.anitabi.cn/points/1/photo.jpg?plan=h320')
  })

  it('keeps the R2 mirror key stable across delivery-host changes', async () => {
    const fromCanonical = computeCanonicalImageUrl('https://image.anitabi.cn/points/1/photo.jpg?plan=h320')
    const fromEdgeOne = computeCanonicalImageUrl('https://img-tc.anitabi.cn/points/1/photo.jpg?plan=h320')
    const fromWww = computeCanonicalImageUrl('https://www.anitabi.cn/images/points/1/photo.jpg?plan=h320')

    // 三个入口的 canonical 必须一致 —— 这是「换 host 不回填」成立的前提。
    expect(fromEdgeOne).toBe(fromCanonical)
    expect(fromWww).toBe(fromCanonical)

    const keyA = await computeMirrorKey(fromCanonical, 'image/jpeg')
    const keyB = await computeMirrorKey(fromEdgeOne, 'image/jpeg')
    expect(keyA).toBe(keyB)
  })
})

describe('anitabi mirror key derivation', () => {
  it('builds mirror keys with host buckets, 24 hex hash fragments, and mapped extensions', async () => {
    const canonicalUrl = computeCanonicalImageUrl('https://anitabi.cn/images/bangumi/123/cover.jpg?plan=h320')

    await expect(computeMirrorKey(canonicalUrl, 'image/jpeg')).resolves.toMatch(
      /^mirror\/v1\/image\.anitabi\.cn\/[0-9a-f]{24}\/\.jpg$/,
    )
  })

  it('produces different keys for different variants', async () => {
    const first = await computeMirrorKey(
      computeCanonicalImageUrl('https://anitabi.cn/images/bangumi/123/cover.jpg?plan=h320'),
      'image/jpeg',
    )
    const second = await computeMirrorKey(
      computeCanonicalImageUrl('https://anitabi.cn/images/bangumi/123/cover.jpg?plan=h160'),
      'image/jpeg',
    )

    expect(first).not.toBe(second)
  })

  it('maps webp mime types to a .webp extension', async () => {
    const canonicalUrl = computeCanonicalImageUrl('https://bgm.tv/pic/cover/l/b8/0d/513345_jv4wM.jpg')

    await expect(computeMirrorKey(canonicalUrl, 'image/webp')).resolves.toMatch(/\/\.webp$/)
  })
})
