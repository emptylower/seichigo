import { beforeAll, describe, expect, it, vi } from 'vitest'

beforeAll(() => {
  if (typeof window === 'undefined') return
  if (typeof window.URL.createObjectURL === 'function') return
  Object.defineProperty(window.URL, 'createObjectURL', {
    value: vi.fn(() => 'blob:maplibre-worker'),
    configurable: true,
  })
})

describe('media normalizePointImageUrl / normalizeCoverImageUrl delivery host', () => {
  it('resolves anitabi point image urls onto the delivery host with w/q params kept', async () => {
    const { normalizePointImageUrl } = await import('@/features/map/anitabi/media')
    expect(
      normalizePointImageUrl('https://image.anitabi.cn/points/217249/db2c913d_1754363336601.jpg?plan=h160'),
    ).toBe('https://img-tc.anitabi.cn/points/217249/db2c913d_1754363336601.jpg?w=640&q=80')
  })

  it('keeps existing w/q params when resolving anitabi point image urls', async () => {
    const { normalizePointImageUrl } = await import('@/features/map/anitabi/media')
    expect(
      normalizePointImageUrl('https://image.anitabi.cn/points/217249/a.jpg?w=320&q=75'),
    ).toBe('https://img-tc.anitabi.cn/points/217249/a.jpg?w=320&q=75')
  })

  it('keeps non-anitabi point image urls untouched', async () => {
    const { normalizePointImageUrl } = await import('@/features/map/anitabi/media')
    expect(normalizePointImageUrl('https://example.com/img/a.jpg')).toBe('https://example.com/img/a.jpg')
    expect(normalizePointImageUrl(null)).toBe(null)
  })

  it('normalizes anitabi covers onto the same display url used for rendering', async () => {
    const { normalizeCoverImageUrl } = await import('@/features/map/anitabi/media')
    expect(normalizeCoverImageUrl('https://image.anitabi.cn/bangumi/290980.jpg')).toBe(
      'https://img-tc.anitabi.cn/bangumi/290980.jpg',
    )
  })

  it('returns null for empty cover input and proxies bgm covers', async () => {
    const { normalizeCoverImageUrl } = await import('@/features/map/anitabi/media')
    expect(normalizeCoverImageUrl(null)).toBe(null)
    expect(normalizeCoverImageUrl('  ')).toBe(null)
    expect(normalizeCoverImageUrl('https://lain.bgm.tv/pic/cover/l/b8/0d/513345_jv4wM.jpg')).toBe(
      'http://localhost:3000/api/anitabi/image-render?url=https%3A%2F%2Flain.bgm.tv%2Fpic%2Fcover%2Fm%2Fb8%2F0d%2F513345_jv4wM.jpg',
    )
  })
})
