import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryShareLinkRepo } from '@/lib/share/repoMemory'

const repo = new MemoryShareLinkRepo(() => new Date('2026-09-08T12:00:00Z'))

vi.mock('@/lib/share/api', () => ({
  getShareApiDeps: async () => ({
    repo,
    pointStateRepo: {},
    getStore: () => null,
    getSession: async () => null,
    now: () => new Date('2026-09-08T12:00:00Z'),
    origin: 'https://seichigo.com',
  }),
}))

const resolveMapShareSnapshotMock = vi.fn()
vi.mock('@/lib/anitabi/share', () => ({
  resolveMapShareSnapshot: (...args: any[]) => resolveMapShareSnapshotMock(...args),
}))

const resolveMirrorPublicUrlMock = vi.fn()
vi.mock('@/lib/anitabi/imageProxy', () => ({
  resolveMirrorPublicUrl: (...args: any[]) => resolveMirrorPublicUrlMock(...args),
}))

const SNAPSHOT = {
  bangumiId: 101,
  bangumiTitle: '你的名字。',
  bangumiCity: '东京',
  bangumiColor: null,
  bangumiCover: 'https://lain.bgm.tv/pic/cover/l/cover.jpg',
  pointsLength: 30,
  pointId: '101:suga',
  pointName: '须贺神社',
  pointEp: '1',
  pointScene: null,
  pointGeo: null,
  pointImage: 'https://image.anitabi.cn/points/101/suga.jpg',
}

async function seed(code: string, imageKey: string | null) {
  await repo.create({
    code,
    pointId: '101:suga',
    bangumiId: 101,
    locale: 'zh',
    layout: 'portrait',
    userId: null,
    ipHash: 'h',
  })
  if (imageKey) await repo.markUploaded(code, { imageKey, userId: 'u1' })
}

describe('/s/[code] generateMetadata', () => {
  beforeEach(() => {
    resolveMapShareSnapshotMock.mockReset()
    resolveMirrorPublicUrlMock.mockReset()
    resolveMapShareSnapshotMock.mockResolvedValue(SNAPSHOT)
  })

  it('有 imageKey 时 OG 图是 /api/share/img/<code> 的绝对地址', async () => {
    await seed('AAAAAAAA', 'share/AAAAAAAA.jpg')
    const { generateMetadata } = await import('@/app/s/[code]/page')
    const meta = await generateMetadata({
      params: Promise.resolve({ code: 'AAAAAAAA' }),
      searchParams: Promise.resolve({}),
    })
    expect(meta.openGraph?.images).toEqual(['https://seichigo.com/api/share/img/AAAAAAAA'])
    expect(meta.twitter?.images).toEqual(['https://seichigo.com/api/share/img/AAAAAAAA'])
    expect(meta.title).toBe('须贺神社｜《你的名字。》圣地巡礼 | SeichiGo')
    expect(meta.robots).toEqual({ index: false, follow: true })
    expect(resolveMirrorPublicUrlMock).not.toHaveBeenCalled()
  })

  it('没有 imageKey 时退回点位动画截图的 R2 公共域 URL', async () => {
    await seed('BBBBBBBB', null)
    resolveMirrorPublicUrlMock.mockResolvedValue('https://img.seichigo.com/mirror/v1/x/y/jpg')
    const { generateMetadata } = await import('@/app/s/[code]/page')
    const meta = await generateMetadata({
      params: Promise.resolve({ code: 'BBBBBBBB' }),
      searchParams: Promise.resolve({}),
    })
    expect(resolveMirrorPublicUrlMock).toHaveBeenCalledWith(SNAPSHOT.pointImage, { kind: 'point' })
    expect(meta.openGraph?.images).toEqual(['https://img.seichigo.com/mirror/v1/x/y/jpg'])
  })

  it('R2 也算不出时退回站点默认 OG', async () => {
    await seed('CCCCCCCC', null)
    resolveMirrorPublicUrlMock.mockResolvedValue(null)
    const { generateMetadata } = await import('@/app/s/[code]/page')
    const meta = await generateMetadata({
      params: Promise.resolve({ code: 'CCCCCCCC' }),
      searchParams: Promise.resolve({}),
    })
    expect(meta.openGraph?.images).toEqual(['https://seichigo.com/opengraph-image'])
  })

  it('短码不存在时只给 noindex 标题', async () => {
    const { generateMetadata } = await import('@/app/s/[code]/page')
    const meta = await generateMetadata({
      params: Promise.resolve({ code: 'ZZZZZZZZ' }),
      searchParams: Promise.resolve({}),
    })
    expect(meta.robots).toEqual({ index: false, follow: false })
    expect(meta.openGraph).toBeUndefined()
  })
})
