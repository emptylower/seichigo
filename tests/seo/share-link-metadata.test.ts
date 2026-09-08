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
    expect(meta.title).toEqual({ absolute: '须贺神社｜《你的名字。》圣地巡礼 | SeichiGo' })
    expect(meta.robots).toEqual({ index: false, follow: true })
    expect(resolveMirrorPublicUrlMock).not.toHaveBeenCalled()
  })

  it('带指纹的新格式 imageKey 会给 OG 图追加 ?v=<指纹>', async () => {
    await seed('EEEEEEEE', 'share/EEEEEEEE-ab12cd34.jpg')
    const { generateMetadata } = await import('@/app/s/[code]/page')
    const meta = await generateMetadata({
      params: Promise.resolve({ code: 'EEEEEEEE' }),
      searchParams: Promise.resolve({}),
    })
    expect(meta.openGraph?.images).toEqual(['https://seichigo.com/api/share/img/EEEEEEEE?v=ab12cd34'])
    expect(meta.twitter?.images).toEqual(['https://seichigo.com/api/share/img/EEEEEEEE?v=ab12cd34'])
  })

  it('没有 imageKey 时指向服务端卡片路由的横版（匿名分享也有卡片预览）', async () => {
    await seed('BBBBBBBB', null)
    const { generateMetadata } = await import('@/app/s/[code]/page')
    const meta = await generateMetadata({
      params: Promise.resolve({ code: 'BBBBBBBB' }),
      searchParams: Promise.resolve({}),
    })
    // 动画截图兜底已收进卡片路由内部（失败时 302），短链页不再调 resolveMirrorPublicUrl
    expect(resolveMirrorPublicUrlMock).not.toHaveBeenCalled()
    expect(meta.openGraph?.images).toEqual([
      'https://seichigo.com/api/share/card/101%3Asuga?locale=zh&layout=landscape',
    ])
  })

  it('卡片路由的兜底由路由自身负责，短链页不再退回站点默认 OG', async () => {
    await seed('CCCCCCCC', null)
    resolveMirrorPublicUrlMock.mockResolvedValue(null)
    const { generateMetadata } = await import('@/app/s/[code]/page')
    const meta = await generateMetadata({
      params: Promise.resolve({ code: 'CCCCCCCC' }),
      searchParams: Promise.resolve({}),
    })
    expect(meta.openGraph?.images).toEqual([
      'https://seichigo.com/api/share/card/101%3Asuga?locale=zh&layout=landscape',
    ])
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

  it('页面体渲染 meta refresh + replace 脚本并调度点击计数', async () => {
    await seed('FFFFFFFF', null)
    const { default: SharePage } = await import('@/app/s/[code]/page')
    const tree = await SharePage({
      params: Promise.resolve({ code: 'FFFFFFFF' }),
      searchParams: Promise.resolve({ c: 'x' }),
    })
    const serialized = JSON.stringify(tree)
    expect(serialized).toContain('httpEquiv')
    expect(serialized).toContain('window.location.replace')
    expect(serialized).toContain('https://seichigo.com/map')
    // fire-and-forget 计数，稍等一拍后生效
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect((await repo.findByCode('FFFFFFFF'))?.clicks).toBe(1)
  })
})
