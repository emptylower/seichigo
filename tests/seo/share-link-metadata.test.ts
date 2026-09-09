import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryShareLinkRepo } from '@/lib/share/repoMemory'
import { buildShareRedirectTarget } from '@/lib/share/view'

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

async function seed(code: string, imageKey: string | null, locale: 'zh' | 'en' | 'ja' = 'zh') {
  await repo.create({
    code,
    pointId: '101:suga',
    bangumiId: 101,
    locale,
    layout: 'portrait',
    userId: null,
    ipHash: 'h',
  })
  if (imageKey) await repo.markUploaded(code, { imageKey, userId: 'u1' })
}

describe('/s/[code] generateMetadata', () => {
  beforeEach(() => {
    resolveMapShareSnapshotMock.mockReset()
    resolveMapShareSnapshotMock.mockResolvedValue(SNAPSHOT)
  })

  it('有 imageKey 时 OG 图是 /api/share/img/<code> 的绝对地址', async () => {
    await seed('AAAAAAAA', 'share/AAAAAAAA.jpg')
    const { generateMetadata } = await import('@/app/s/[code]/page')
    const meta = await generateMetadata({
      params: Promise.resolve({ code: 'AAAAAAAA' }),
      searchParams: Promise.resolve({}),
    })
    expect(meta.openGraph?.images).toEqual([
      expect.objectContaining({ url: 'https://seichigo.com/api/share/img/AAAAAAAA' }),
    ])
    expect(meta.twitter?.images).toEqual([
      expect.objectContaining({ url: 'https://seichigo.com/api/share/img/AAAAAAAA' }),
    ])
    expect(meta.title).toEqual({ absolute: '须贺神社｜《你的名字。》圣地巡礼 | SeichiGo' })
    expect(meta.robots).toEqual({ index: false, follow: true })
  })

  it('带指纹的新格式 imageKey 会给 OG 图追加 ?v=<指纹>', async () => {
    await seed('EEEEEEEE', 'share/EEEEEEEE-ab12cd34.jpg')
    const { generateMetadata } = await import('@/app/s/[code]/page')
    const meta = await generateMetadata({
      params: Promise.resolve({ code: 'EEEEEEEE' }),
      searchParams: Promise.resolve({}),
    })
    expect(meta.openGraph?.images).toEqual([
      expect.objectContaining({ url: 'https://seichigo.com/api/share/img/EEEEEEEE?v=ab12cd34' }),
    ])
    expect(meta.twitter?.images).toEqual([
      expect.objectContaining({ url: 'https://seichigo.com/api/share/img/EEEEEEEE?v=ab12cd34' }),
    ])
  })

  it('没有 imageKey 时指向服务端卡片路由的横版（匿名分享也有卡片预览）', async () => {
    await seed('BBBBBBBB', null)
    const { generateMetadata } = await import('@/app/s/[code]/page')
    const meta = await generateMetadata({
      params: Promise.resolve({ code: 'BBBBBBBB' }),
      searchParams: Promise.resolve({}),
    })
    // 动画截图兜底已收进卡片路由内部（失败时同源代理/302），短链页不再调 resolveMirrorPublicUrl
    expect(meta.openGraph?.images).toEqual([
      expect.objectContaining({
        url: 'https://seichigo.com/api/share/card/101%3Asuga/zh/landscape.jpg',
      }),
    ])
  })

  it('OG 图对象带 width/height/type：上传卡按链接版式，匿名卡按横版', async () => {
    await seed('GGGGGGGG', 'share/GGGGGGGG-00000001.jpg')
    const { generateMetadata } = await import('@/app/s/[code]/page')
    const uploaded = await generateMetadata({
      params: Promise.resolve({ code: 'GGGGGGGG' }),
      searchParams: Promise.resolve({}),
    })
    expect(uploaded.openGraph?.images).toEqual([
      expect.objectContaining({ width: 1080, height: 1440, type: 'image/jpeg' }),
    ])
    expect(uploaded.twitter?.images).toEqual([
      expect.objectContaining({ width: 1080, height: 1440, type: 'image/jpeg' }),
    ])

    await seed('HHHHHHHH', null)
    const anon = await generateMetadata({
      params: Promise.resolve({ code: 'HHHHHHHH' }),
      searchParams: Promise.resolve({}),
    })
    expect(anon.openGraph?.images).toEqual([
      expect.objectContaining({ width: 1200, height: 630, type: 'image/jpeg' }),
    ])
    expect((anon.openGraph?.images as { alt: string }[])[0]?.alt).toBe(
      '《你的名字。》须贺神社分享卡片',
    )
  })

  it('卡片路由的兜底由路由自身负责，短链页不再退回站点默认 OG', async () => {
    await seed('CCCCCCCC', null)
    const { generateMetadata } = await import('@/app/s/[code]/page')
    const meta = await generateMetadata({
      params: Promise.resolve({ code: 'CCCCCCCC' }),
      searchParams: Promise.resolve({}),
    })
    expect(meta.openGraph?.images).toEqual([
      expect.objectContaining({
        url: 'https://seichigo.com/api/share/card/101%3Asuga/zh/landscape.jpg',
      }),
    ])
  })

  it('openGraph 带 siteName=SeichiGo 与按链接语言映射的 og:locale', async () => {
    await seed('IIIIIIII', null, 'zh')
    await seed('JJJJJJJJ', null, 'ja')
    await seed('KKKKKKKK', null, 'en')
    const { generateMetadata } = await import('@/app/s/[code]/page')

    const zh = await generateMetadata({
      params: Promise.resolve({ code: 'IIIIIIII' }),
      searchParams: Promise.resolve({}),
    })
    expect(zh.openGraph?.siteName).toBe('SeichiGo')
    expect(zh.openGraph?.locale).toBe('zh_CN')

    const ja = await generateMetadata({
      params: Promise.resolve({ code: 'JJJJJJJJ' }),
      searchParams: Promise.resolve({}),
    })
    expect(ja.openGraph?.siteName).toBe('SeichiGo')
    expect(ja.openGraph?.locale).toBe('ja_JP')

    const en = await generateMetadata({
      params: Promise.resolve({ code: 'KKKKKKKK' }),
      searchParams: Promise.resolve({}),
    })
    expect(en.openGraph?.siteName).toBe('SeichiGo')
    expect(en.openGraph?.locale).toBe('en_US')
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

  it('页面体无 meta refresh，跳转只靠 replace 脚本并调度点击计数', async () => {
    await seed('FFFFFFFF', null)
    const { default: SharePage } = await import('@/app/s/[code]/page')
    const tree = await SharePage({
      params: Promise.resolve({ code: 'FFFFFFFF' }),
      searchParams: Promise.resolve({ c: 'x' }),
    })
    const serialized = JSON.stringify(tree)
    // Telegram 等抓取器会跟随 meta refresh 改用地图页的 og:image，必须整段删掉
    expect(serialized).not.toContain('httpEquiv')
    expect(serialized).not.toContain('refresh')
    const target = buildShareRedirectTarget({ locale: 'zh', bangumiId: 101, pointId: '101:suga', channel: 'x' })
    const absolute = `https://seichigo.com${target}`
    // __html 经外层 JSON.stringify 后引号转义，按序列化形态比对脚本全文
    const scriptHtml = `window.location.replace(${JSON.stringify(absolute)});`
    expect(serialized).toContain(JSON.stringify(scriptHtml).slice(1, -1))
    // 禁用 JS 的兜底：<a> 指向同一目标
    expect(serialized).toContain(`"href":"${absolute}"`)
    // fire-and-forget 计数，稍等一拍后生效
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect((await repo.findByCode('FFFFFFFF'))?.clicks).toBe(1)
  })

  it('禁用 JS 的兜底链接文案按 locale 三语', async () => {
    await seed('MMMMMMMM', null, 'zh')
    await seed('NNNNNNNN', null, 'ja')
    await seed('OOOOOOOO', null, 'en')
    const { default: SharePage } = await import('@/app/s/[code]/page')

    const zh = JSON.stringify(
      await SharePage({ params: Promise.resolve({ code: 'MMMMMMMM' }), searchParams: Promise.resolve({}) }),
    )
    const ja = JSON.stringify(
      await SharePage({ params: Promise.resolve({ code: 'NNNNNNNN' }), searchParams: Promise.resolve({}) }),
    )
    const en = JSON.stringify(
      await SharePage({ params: Promise.resolve({ code: 'OOOOOOOO' }), searchParams: Promise.resolve({}) }),
    )
    expect(zh).toContain('正在前往地图，若未自动跳转请点此')
    expect(ja).toContain('地図へ移動しています。移動しない場合はこちら')
    expect(en).toContain("Opening the map. Tap here if it doesn't redirect.")
  })
})
