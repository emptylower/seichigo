import { describe, expect, it, vi, beforeEach } from 'vitest'
import { buildMapShareImageUrl, parseMapShareQuery, toUrlSearchParams } from '@/lib/anitabi/share'

const getBangumiDetailMock = vi.fn()
vi.mock('@/lib/anitabi/read', () => ({
  getBangumiDetail: (...args: any[]) => getBangumiDetailMock(...args),
}))
vi.mock('@/lib/anitabi/api', () => ({
  getAnitabiApiDeps: async () => ({ prisma: {} }),
}))
const resolveMirrorPublicUrlMock = vi.fn()
vi.mock('@/lib/anitabi/imageProxy', () => ({
  resolveMirrorPublicUrl: (...args: any[]) => resolveMirrorPublicUrlMock(...args),
}))

function detail(pointImage: string | null, cover: string | null) {
  return {
    card: { id: 101, title: '你的名字。', city: '东京', color: null, cover },
    points: [
      {
        id: '101:suga',
        bangumiId: 101,
        name: '须贺神社',
        nameZh: '须贺神社',
        note: null,
        geo: [35.6, 139.7] as [number, number],
        ep: '1',
        s: null,
        image: pointImage,
        origin: null,
        originUrl: null,
        originLink: null,
        density: null,
        mark: null,
      },
    ],
  }
}

describe('anitabi share helpers', () => {
  it('parses bangumi and point from query params', () => {
    const query = parseMapShareQuery(new URLSearchParams({ b: '101', p: '101:station' }))
    expect(query).toEqual({ b: 101, p: '101:station' })
  })

  it('falls back to point prefix when bangumi id is missing', () => {
    const query = parseMapShareQuery(new URLSearchParams({ p: '223:harbor' }))
    expect(query).toEqual({ b: 223, p: '223:harbor' })
  })

  it('ignores invalid bangumi id values', () => {
    const query = parseMapShareQuery(new URLSearchParams({ b: 'not-a-number', p: 'spot' }))
    expect(query).toEqual({ b: null, p: 'spot' })
  })

  it('normalizes search params objects', () => {
    const params = toUrlSearchParams({
      b: '101',
      p: ['101:station'],
      q: ' ',
    })
    expect(params.toString()).toBe('b=101&p=101%3Astation')
  })
})

describe('buildMapShareImageUrl 三级回退', () => {
  beforeEach(() => {
    getBangumiDetailMock.mockReset()
    resolveMirrorPublicUrlMock.mockReset()
  })

  it('有点位截图时返回点位图的 R2 公共域 URL', async () => {
    getBangumiDetailMock.mockResolvedValue(detail('https://image.anitabi.cn/points/101/suga.jpg', 'https://lain.bgm.tv/c.jpg'))
    resolveMirrorPublicUrlMock.mockResolvedValue('https://img.seichigo.com/mirror/v1/a/b/jpg')
    await expect(buildMapShareImageUrl('zh', { b: 101, p: '101:suga' })).resolves.toBe(
      'https://img.seichigo.com/mirror/v1/a/b/jpg',
    )
    expect(resolveMirrorPublicUrlMock).toHaveBeenCalledWith(
      'https://image.anitabi.cn/points/101/suga.jpg',
      { kind: 'point' },
    )
  })

  it('p 缺失时退回作品封面的 R2 公共域 URL', async () => {
    getBangumiDetailMock.mockResolvedValue(detail('https://image.anitabi.cn/points/101/suga.jpg', 'https://lain.bgm.tv/c.jpg'))
    resolveMirrorPublicUrlMock.mockResolvedValue('https://img.seichigo.com/mirror/v1/c/d/jpg')
    await expect(buildMapShareImageUrl('zh', { b: 101, p: null })).resolves.toBe(
      'https://img.seichigo.com/mirror/v1/c/d/jpg',
    )
    expect(resolveMirrorPublicUrlMock).toHaveBeenCalledWith('https://lain.bgm.tv/c.jpg', { kind: 'cover' })
  })

  it('都算不出时退回站点默认 OG', async () => {
    getBangumiDetailMock.mockResolvedValue(detail(null, null))
    await expect(buildMapShareImageUrl('en', { b: 101, p: null })).resolves.toMatch(/\/opengraph-image$/)
  })

  it('没有 b 参数时不查库，直接站点默认 OG', async () => {
    await expect(buildMapShareImageUrl('en', { b: null, p: null })).resolves.toMatch(/\/opengraph-image$/)
    expect(getBangumiDetailMock).not.toHaveBeenCalled()
  })
})
