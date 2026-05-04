import { describe, expect, it } from 'vitest'
import { computeCanonicalImageUrl, computeMirrorKey } from '@/lib/anitabi/imageNormalize'

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
