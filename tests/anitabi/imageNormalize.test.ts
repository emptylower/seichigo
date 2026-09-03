import { afterEach, describe, expect, it } from 'vitest'
import {
  computeCanonicalImageUrl,
  computeMirrorKey,
  isAnitabiPointImagePath,
  normalizeAnitabiDisplayVariant,
  resolveAnitabiDeliveryUrl,
} from '@/lib/anitabi/imageNormalize'

describe('isAnitabiPointImagePath', () => {
  it('recognizes canonical /points/ paths', () => {
    expect(isAnitabiPointImagePath('/points/38125/y.jpg')).toBe(true)
  })

  it('recognizes user-uploaded point paths', () => {
    expect(isAnitabiPointImagePath('/user/0/bangumi/899/points/x.jpg')).toBe(true)
    expect(isAnitabiPointImagePath('/user/1181/bangumi/321/points/n7zunh4aj.jpg')).toBe(true)
  })

  it('recognizes /images/ prefixed copies of both shapes', () => {
    expect(isAnitabiPointImagePath('/images/points/38125/y.jpg')).toBe(true)
    expect(isAnitabiPointImagePath('/images/user/0/bangumi/899/points/x.jpg')).toBe(true)
  })

  it('rejects non-point anitabi paths and malformed user paths', () => {
    expect(isAnitabiPointImagePath('/bangumi/123/cover.jpg')).toBe(false)
    expect(isAnitabiPointImagePath('/user/0/a.jpg')).toBe(false)
    expect(isAnitabiPointImagePath('/user/abc/bangumi/1/points/x.jpg')).toBe(false)
    expect(isAnitabiPointImagePath('/user/0/other/1/points/x.jpg')).toBe(false)
  })
})

describe('normalizeAnitabiDisplayVariant', () => {
  function apply(rawUrl: string, kind: 'point' | 'point-preview' | 'point-thumbnail') {
    const url = new URL(rawUrl)
    normalizeAnitabiDisplayVariant(url, kind)
    return url.toString()
  }

  it('rewrites every anitabi point path (canonical, user-uploaded, /images) to w=640&q=80 for point kinds', () => {
    expect(apply('https://image.anitabi.cn/points/38125/y.jpg', 'point')).toBe(
      'https://image.anitabi.cn/points/38125/y.jpg?w=640&q=80',
    )
    expect(apply('https://image.anitabi.cn/user/0/bangumi/899/points/x.jpg', 'point-preview')).toBe(
      'https://image.anitabi.cn/user/0/bangumi/899/points/x.jpg?w=640&q=80',
    )
    expect(apply('https://www.anitabi.cn/images/user/0/bangumi/899/points/x.jpg', 'point')).toBe(
      'https://image.anitabi.cn/user/0/bangumi/899/points/x.jpg?w=640&q=80',
    )
  })

  it('strips stale plan params (including h320) from point paths for point kinds', () => {
    expect(apply('https://image.anitabi.cn/points/38125/y.jpg?plan=h320', 'point')).toBe(
      'https://image.anitabi.cn/points/38125/y.jpg?w=640&q=80',
    )
    expect(apply('https://image.anitabi.cn/user/0/bangumi/899/points/x.jpg?plan=h160', 'point')).toBe(
      'https://image.anitabi.cn/user/0/bangumi/899/points/x.jpg?w=640&q=80',
    )
  })

  it('keeps existing w/h resize params and only tops up q for point kinds', () => {
    expect(apply('https://image.anitabi.cn/points/38125/y.jpg?h=320', 'point')).toBe(
      'https://image.anitabi.cn/points/38125/y.jpg?h=320&q=80',
    )
  })

  it('normalizes point paths to the h160 plan variant for point-thumbnail displays', () => {
    expect(apply('https://image.anitabi.cn/user/0/bangumi/899/points/x.jpg', 'point-thumbnail')).toBe(
      'https://image.anitabi.cn/user/0/bangumi/899/points/x.jpg?plan=h160',
    )
    expect(apply('https://image.anitabi.cn/points/38125/y.jpg?w=640&q=80', 'point-thumbnail')).toBe(
      'https://image.anitabi.cn/points/38125/y.jpg?plan=h160',
    )
  })

  it('never produces plan=h320 for any kind or path shape', () => {
    const cases = [
      'https://image.anitabi.cn/points/38125/y.jpg',
      'https://image.anitabi.cn/user/0/bangumi/899/points/x.jpg',
      'https://image.anitabi.cn/user/0/a.jpg',
      'https://image.anitabi.cn/bangumi/123/cover.jpg',
    ] as const
    const kinds = ['point', 'point-preview', 'point-thumbnail'] as const

    for (const rawUrl of cases) {
      for (const kind of kinds) {
        expect(apply(rawUrl, kind)).not.toContain('plan=h320')
      }
    }
  })

  it('adds plan=h160 for point-thumbnail displays on non-point anitabi paths and leaves point kinds untouched there', () => {
    expect(apply('https://image.anitabi.cn/user/0/a.jpg', 'point-thumbnail')).toBe(
      'https://image.anitabi.cn/user/0/a.jpg?plan=h160',
    )
    expect(apply('https://image.anitabi.cn/user/0/a.jpg', 'point')).toBe(
      'https://image.anitabi.cn/user/0/a.jpg',
    )
  })
})


describe('anitabi image normalization', () => {
  it('rewrites anitabi image hosts and strips the /images prefix', () => {
    expect(
      computeCanonicalImageUrl('https://anitabi.cn/images/bangumi/123/cover.jpg?plan=l'),
    ).toBe('https://image.anitabi.cn/bangumi/123/cover.jpg?plan=l')
  })

  it('collapses bgm cover variants from /l/ to /m/', () => {
    expect(
      computeCanonicalImageUrl('https://lain.bgm.tv/pic/cover/l/b8/0d/513345_jv4wM.jpg'),
    ).toBe('https://lain.bgm.tv/pic/cover/m/b8/0d/513345_jv4wM.jpg')
  })

  it('strips diagnostic parameters, retry markers, and name while sorting remaining params', () => {
    expect(
      computeCanonicalImageUrl(
        'https://image.anitabi.cn/points/1/photo.jpg?z=9&__mi_session=s1&_retry=2&name=cover&w=640&__mi_chain=c1&q=80&plan=h160&__mi_request=r1',
      ),
    ).toBe('https://image.anitabi.cn/points/1/photo.jpg?plan=h160&q=80&w=640&z=9')
  })

  it('treats reordered query strings as the same canonical URL', () => {
    const first = computeCanonicalImageUrl(
      'https://image.anitabi.cn/points/1/photo.jpg?plan=h160&q=80&w=640&z=9',
    )
    const second = computeCanonicalImageUrl(
      'https://image.anitabi.cn/points/1/photo.jpg?z=9&w=640&plan=h160&q=80',
    )

    expect(first).toBe(second)
  })

  it('lowercases protocol and host in the canonical output', () => {
    expect(
      computeCanonicalImageUrl('HTTPS://WWW.ANITABI.CN/images/bangumi/123/cover.jpg?plan=l'),
    ).toBe('https://image.anitabi.cn/bangumi/123/cover.jpg?plan=l')
  })

  it('rejects relative URLs for mirror canonicalization', () => {
    expect(() => computeCanonicalImageUrl('/images/bangumi/123/cover.jpg?plan=l')).toThrow('invalid_image_url')
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
      resolveAnitabiDeliveryUrl('https://image.anitabi.cn/points/1/photo.jpg?plan=h160').toString(),
    ).toBe('https://img-tc.anitabi.cn/points/1/photo.jpg?plan=h160')
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
      computeCanonicalImageUrl('https://img-tc.anitabi.cn/points/1/photo.jpg?plan=h160'),
    ).toBe('https://image.anitabi.cn/points/1/photo.jpg?plan=h160')
  })

  it('keeps the R2 mirror key stable across delivery-host changes', async () => {
    const fromCanonical = computeCanonicalImageUrl('https://image.anitabi.cn/points/1/photo.jpg?plan=h160')
    const fromEdgeOne = computeCanonicalImageUrl('https://img-tc.anitabi.cn/points/1/photo.jpg?plan=h160')
    const fromWww = computeCanonicalImageUrl('https://www.anitabi.cn/images/points/1/photo.jpg?plan=h160')

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
    const canonicalUrl = computeCanonicalImageUrl('https://anitabi.cn/images/bangumi/123/cover.jpg?plan=l')

    await expect(computeMirrorKey(canonicalUrl, 'image/jpeg')).resolves.toMatch(
      /^mirror\/v1\/image\.anitabi\.cn\/[0-9a-f]{24}\/\.jpg$/,
    )
  })

  it('produces different keys for different variants', async () => {
    const first = await computeMirrorKey(
      computeCanonicalImageUrl('https://anitabi.cn/images/bangumi/123/cover.jpg?plan=l'),
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
