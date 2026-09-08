import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cardCacheKey,
  createGetCardHandler,
  isCheckinPhotoKey,
  MAX_INLINE_IMAGE_BYTES,
  normalizeCardLayout,
  normalizeCardLocale,
  renderAndStoreCard,
} from '@/lib/share/handlers/card'
import type { CardDeps } from '@/lib/share/handlers/card'
import { ANON_DAILY_CARD_LIMIT, DAILY_RENDER_BUDGET, resetCardRate } from '@/lib/share/cardBudget'
import { MemoryPointContextRepo } from '@/lib/share/pointContextRepoMemory'
import type { PointContextRow } from '@/lib/share/pointContextRepo'
import type { ShareStore } from '@/lib/share/store'

const NOW = new Date('2026-09-08T12:00:00Z')

const ROW: PointContextRow = {
  pointId: '101:suga',
  bangumiId: 101,
  ep: '1',
  scene: '1194',
  image: 'https://image.anitabi.cn/points/101/suga.jpg',
  name: '《你的名字。》须贺神社',
  localizedName: null,
  mark: '男女主角重逢的阶梯',
  localizedNote: null,
  geoLat: 35.6895,
  geoLng: 139.7,
  localizedBangumiTitle: '你的名字。',
  bangumiTitleCandidates: ['你的名字。'],
  bangumiTitles: { zh: '你的名字。', jaRaw: null, original: null, romaji: null, english: null },
}

export function makeStore(seed?: Record<string, Uint8Array>) {
  const objects = new Map<string, { bytes: Uint8Array; contentType: string }>()
  for (const [key, bytes] of Object.entries(seed ?? {})) {
    objects.set(key, { bytes, contentType: 'image/jpeg' })
  }
  const store: ShareStore = {
    async put(key, bytes, contentType) {
      objects.set(key, { bytes, contentType })
    },
    async get(key) {
      const found = objects.get(key)
      if (!found) return null
      return {
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(found.bytes)
            controller.close()
          },
        }),
        contentType: found.contentType,
        size: found.bytes.byteLength,
      }
    },
    async head(key) {
      const found = objects.get(key)
      if (!found) return null
      return { size: found.bytes.byteLength, contentType: found.contentType }
    },
    async delete(key) {
      objects.delete(key)
    },
  }
  return { store, objects }
}

export function makeDeps(overrides: Partial<CardDeps> = {}): CardDeps {
  const { store } = makeStore()
  return {
    repo: new MemoryPointContextRepo([ROW]),
    geocode: async () => null,
    getStore: () => store,
    renderCard: vi.fn(async () => new Uint8Array([0x52, 0x49, 0x46, 0x46])),
    resolveAnimeImageUrl: async () => 'https://img.seichigo.com/mirror/v1/x/y.jpg',
    fetchImage: async () => ({ bytes: new Uint8Array([1, 2, 3]), contentType: 'image/jpeg' }),
    origin: 'https://seichigo.com',
    now: () => NOW,
    ...overrides,
  }
}

describe('参数归一', () => {
  it('locale 非法回落 zh，layout 非法回落 landscape', () => {
    expect(normalizeCardLocale('ja')).toBe('ja')
    expect(normalizeCardLocale('de')).toBe('zh')
    expect(normalizeCardLocale(null)).toBe('zh')
    expect(normalizeCardLayout('portrait')).toBe('portrait')
    expect(normalizeCardLayout('square')).toBe('landscape')
  })

  it('photo 只接受 checkin/<userId>/<pointId>.jpg 形状，且点位段必须等于本次 pointId', () => {
    expect(isCheckinPhotoKey('checkin/u1/101:suga.jpg', '101:suga')).toBe(true)
    expect(isCheckinPhotoKey('share/AbC12xYz-deadbeef.webp', '101:suga')).toBe(false)
    expect(isCheckinPhotoKey('checkin/../../etc/passwd.jpg', '101:suga')).toBe(false)
    expect(isCheckinPhotoKey('checkin/u1/p.png', '101:suga')).toBe(false)
    expect(isCheckinPhotoKey('', '101:suga')).toBe(false)
  })

  it('跨点位的实拍 key 被拒：不能把别人的实拍合成到别的点位', () => {
    expect(isCheckinPhotoKey('checkin/u1/other:point.jpg', '101:suga')).toBe(false)
    expect(isCheckinPhotoKey('checkin/u1/101:suga.jpg', 'other:point')).toBe(false)
  })
})

describe('cardCacheKey', () => {
  it('无实拍时按 pointId__locale__layout', async () => {
    expect(await cardCacheKey('101:suga', 'zh', 'landscape', null)).toBe(
      'og-cards/101:suga__zh__landscape.jpg',
    )
  })

  it('带实拍时追加 photoKey 的 sha256 前 12 位', async () => {
    const key = await cardCacheKey('101:suga', 'ja', 'portrait', 'checkin/u1/101:suga.jpg')
    expect(key.startsWith('og-cards/101:suga__ja__portrait__')).toBe(true)
    expect(/__[0-9a-f]{12}\.jpg$/.test(key)).toBe(true)
  })

  it('同一实拍 key 两次算出同一缓存键', async () => {
    const a = await cardCacheKey('p', 'zh', 'landscape', 'checkin/u1/p.jpg')
    const b = await cardCacheKey('p', 'zh', 'landscape', 'checkin/u1/p.jpg')
    expect(a).toBe(b)
  })
})

describe('renderAndStoreCard', () => {
  it('渲染成功后写进 R2 并返回 rendered', async () => {
    const { store, objects } = makeStore()
    const deps = makeDeps({ getStore: () => store })
    const outcome = await renderAndStoreCard(deps, {
      pointId: '101:suga',
      locale: 'zh',
      layout: 'landscape',
      photoKey: null,
    })
    expect(outcome.status).toBe('rendered')
    if (outcome.status === 'rendered') {
      expect(outcome.bytes.byteLength).toBeGreaterThan(0)
      expect(outcome.contentType).toBe('image/jpeg')
    }
    expect(objects.get('og-cards/101:suga__zh__landscape.jpg')?.contentType).toBe('image/jpeg')
  })

  it('把动画截图内联成 base64 传给渲染器，HTML 里不留外链', async () => {
    const renderCard = vi.fn(
      async (_input: { html: string; width: number; height: number }) => new Uint8Array([1]),
    )
    const deps = makeDeps({ renderCard })
    await renderAndStoreCard(deps, {
      pointId: '101:suga',
      locale: 'zh',
      layout: 'landscape',
      photoKey: null,
    })
    const html = renderCard.mock.calls[0]![0].html
    expect(html).toContain('data:image/jpeg;base64,')
    expect(html).not.toContain('https://img.seichigo.com')
    // scene 原样传入，mm:ss 格式化在 cardHtml 内部完成
    expect(html).toContain('19:54')
  })

  it('取动画截图失败时用粉色渐变兜底，仍然出图', async () => {
    const deps = makeDeps({ fetchImage: async () => null })
    const outcome = await renderAndStoreCard(deps, {
      pointId: '101:suga',
      locale: 'zh',
      layout: 'landscape',
      photoKey: null,
    })
    expect(outcome.status).toBe('rendered')
  })

  it('二维码编码的是稳定深链，不含短码', async () => {
    const renderCard = vi.fn(
      async (_input: { html: string; width: number; height: number }) => new Uint8Array([1]),
    )
    await renderAndStoreCard(makeDeps({ renderCard }), {
      pointId: '101:suga',
      locale: 'ja',
      layout: 'portrait',
      photoKey: null,
    })
    // 深链本身只出现在二维码的模块里，这里断言 HTML 没有短链路径
    expect(renderCard.mock.calls[0]![0].html).not.toContain('/s/')
  })

  it('点位不存在返回 not_found 且不写 R2', async () => {
    const { store, objects } = makeStore()
    const deps = makeDeps({ getStore: () => store, repo: new MemoryPointContextRepo([]) })
    const outcome = await renderAndStoreCard(deps, {
      pointId: 'nope',
      locale: 'zh',
      layout: 'landscape',
      photoKey: null,
    })
    expect(outcome.status).toBe('not_found')
    expect(objects.size).toBe(0)
  })

  it('渲染器返回 null 时返回 failed 且不写缓存', async () => {
    const { store, objects } = makeStore()
    const deps = makeDeps({ getStore: () => store, renderCard: async () => null })
    const outcome = await renderAndStoreCard(deps, {
      pointId: '101:suga',
      locale: 'zh',
      layout: 'landscape',
      photoKey: null,
    })
    expect(outcome.status).toBe('failed')
    expect(objects.has('og-cards/101:suga__zh__landscape.jpg')).toBe(false)
  })

  it('渲染失败时预算仍加一（Browser Run 时长成败都消耗）', async () => {
    const { store, objects } = makeStore()
    const deps = makeDeps({ getStore: () => store, renderCard: async () => null })
    await renderAndStoreCard(deps, {
      pointId: '101:suga',
      locale: 'zh',
      layout: 'landscape',
      photoKey: null,
    })
    const budget = objects.get('og-cards/_budget/2026-09-08.json')
    expect(new TextDecoder().decode(budget!.bytes)).toBe('{"count":1}')
    expect(objects.has('og-cards/101:suga__zh__landscape.jpg')).toBe(false)
  })

  it('缓存已存在时返回 cached 且不调渲染器（预热与请求共用同一条路）', async () => {
    const { store } = makeStore({
      'og-cards/101:suga__zh__landscape.jpg': new Uint8Array([7, 7, 7]),
    })
    const renderCard = vi.fn(async () => new Uint8Array([9]))
    const outcome = await renderAndStoreCard(makeDeps({ getStore: () => store, renderCard }), {
      pointId: '101:suga',
      locale: 'zh',
      layout: 'landscape',
      photoKey: null,
    })
    expect(outcome.status).toBe('cached')
    if (outcome.status === 'cached') {
      expect(Array.from(outcome.bytes)).toEqual([7, 7, 7])
    }
    expect(renderCard).not.toHaveBeenCalled()
  })

  it('预热路径的渲染同样计入日预算', async () => {
    const { store, objects } = makeStore()
    const outcome = await renderAndStoreCard(makeDeps({ getStore: () => store }), {
      pointId: '101:suga',
      locale: 'zh',
      layout: 'landscape',
      photoKey: null,
    })
    expect(outcome.status).toBe('rendered')
    const budget = objects.get('og-cards/_budget/2026-09-08.json')
    expect(new TextDecoder().decode(budget!.bytes)).toBe('{"count":1}')
  })

  it('预算耗尽时预热直接返回 budget_exhausted，不再渲染', async () => {
    const { store } = makeStore({
      'og-cards/_budget/2026-09-08.json': new TextEncoder().encode(
        JSON.stringify({ count: DAILY_RENDER_BUDGET }),
      ),
    })
    const renderCard = vi.fn(async () => new Uint8Array([1]))
    const outcome = await renderAndStoreCard(makeDeps({ getStore: () => store, renderCard }), {
      pointId: '101:suga',
      locale: 'zh',
      layout: 'landscape',
      photoKey: null,
    })
    expect(outcome.status).toBe('budget_exhausted')
    expect(renderCard).not.toHaveBeenCalled()
  })

  it('带实拍时从 ASSET_STORE 读原图并内联', async () => {
    const photo = new Uint8Array([9, 9, 9])
    const { store } = makeStore({ 'checkin/u1/101:suga.jpg': photo })
    const renderCard = vi.fn(
      async (_input: { html: string; width: number; height: number }) => new Uint8Array([1]),
    )
    await renderAndStoreCard(makeDeps({ getStore: () => store, renderCard }), {
      pointId: '101:suga',
      locale: 'zh',
      layout: 'landscape',
      photoKey: 'checkin/u1/101:suga.jpg',
    })
    expect(renderCard.mock.calls[0]![0].html).toContain('data:image/jpeg;base64,CQkJ')
  })

  it('实拍超过内联上限时不读字节，当没传处理', async () => {
    const { store } = makeStore({
      'checkin/u1/101:suga.jpg': new Uint8Array(MAX_INLINE_IMAGE_BYTES + 1),
    })
    const renderCard = vi.fn(
      async (_input: { html: string; width: number; height: number }) => new Uint8Array([1]),
    )
    await renderAndStoreCard(makeDeps({ getStore: () => store, renderCard }), {
      pointId: '101:suga',
      locale: 'zh',
      layout: 'landscape',
      photoKey: 'checkin/u1/101:suga.jpg',
    })
    const html = renderCard.mock.calls[0]![0].html
    // 超限实拍不进 HTML：没有实拍的 data URI，也不切对比布局（动画截图仍内联）
    expect(html).not.toContain('data:image/jpeg;base64,CQkJ')
    expect(html).not.toContain('class="visual compare"')
    expect(html).toContain('data:image/jpeg;base64,')
  })

  it('上游 contentType 含引号时白名单回落 image/jpeg，不产生属性逃逸', async () => {
    const renderCard = vi.fn(
      async (_input: { html: string; width: number; height: number }) => new Uint8Array([1]),
    )
    await renderAndStoreCard(
      makeDeps({
        renderCard,
        fetchImage: async () => ({
          bytes: new Uint8Array([1]),
          contentType: 'image/jpeg" onload="alert(1)',
        }),
      }),
      { pointId: '101:suga', locale: 'zh', layout: 'landscape', photoKey: null },
    )
    const html = renderCard.mock.calls[0]![0].html
    expect(html).toContain('data:image/jpeg;base64,')
    expect(html).not.toContain('onload')
  })
})

function get(url: string, ip?: string): Request {
  return new Request(url, { headers: ip ? { 'cf-connecting-ip': ip } : undefined })
}

const CARD_URL = 'https://seichigo.com/api/share/card/101%3Asuga?locale=zh&layout=landscape'
const params = (pointId = '101:suga') => ({ params: Promise.resolve({ pointId }) })

beforeEach(() => resetCardRate())

describe('GET /api/share/card/[pointId]', () => {
  it('缓存命中直接回图，immutable，且不触发渲染', async () => {
    const { store } = makeStore({
      'og-cards/101:suga__zh__landscape.jpg': new Uint8Array([1, 2, 3]),
    })
    const renderCard = vi.fn(async () => new Uint8Array([9]))
    const res = await createGetCardHandler(makeDeps({ getStore: () => store, renderCard }))(
      get(CARD_URL, '1.2.3.4'),
      params(),
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/jpeg')
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    expect(renderCard).not.toHaveBeenCalled()
  })

  it('未命中时渲染、写缓存并回图', async () => {
    const { store, objects } = makeStore()
    const res = await createGetCardHandler(makeDeps({ getStore: () => store }))(
      get(CARD_URL, '1.2.3.4'),
      params(),
    )
    expect(res.status).toBe(200)
    expect(objects.has('og-cards/101:suga__zh__landscape.jpg')).toBe(true)
  })

  it('非法 pointId 直接 400', async () => {
    const res = await createGetCardHandler(makeDeps())(
      get('https://seichigo.com/api/share/card/..%2F..%2Fetc'),
      params('../../etc'),
    )
    expect(res.status).toBe(400)
  })

  it('畸形百分号序列的 pointId 回 400 而不是 500', async () => {
    const res = await createGetCardHandler(makeDeps())(
      get('https://seichigo.com/api/share/card/%'),
      params('%'),
    )
    expect(res.status).toBe(400)
  })

  it('locale/layout 非法值回落 zh/landscape（不报错）', async () => {
    const { store, objects } = makeStore()
    const res = await createGetCardHandler(makeDeps({ getStore: () => store }))(
      get('https://seichigo.com/api/share/card/101%3Asuga?locale=de&layout=square'),
      params(),
    )
    expect(res.status).toBe(200)
    expect(objects.has('og-cards/101:suga__zh__landscape.jpg')).toBe(true)
  })

  it('photo 形状不对时当作没传（不 500、不越权读桶）', async () => {
    const { store, objects } = makeStore()
    const res = await createGetCardHandler(makeDeps({ getStore: () => store }))(
      get(`${CARD_URL}&photo=share%2FAbC12xYz-deadbeef.webp`),
      params(),
    )
    expect(res.status).toBe(200)
    expect(objects.has('og-cards/101:suga__zh__landscape.jpg')).toBe(true)
  })

  it('photo 不在桶里时也当作没传', async () => {
    const { store, objects } = makeStore()
    const res = await createGetCardHandler(makeDeps({ getStore: () => store }))(
      get(`${CARD_URL}&photo=checkin%2Fu1%2F101%3Asuga.jpg`),
      params(),
    )
    expect(res.status).toBe(200)
    expect(objects.has('og-cards/101:suga__zh__landscape.jpg')).toBe(true)
  })

  it('photo 是别的点位的实拍时当作没传（防跨点位合成后长期缓存）', async () => {
    const { store, objects } = makeStore({
      'checkin/u1/other:point.jpg': new Uint8Array([1, 1]),
    })
    const res = await createGetCardHandler(makeDeps({ getStore: () => store }))(
      get(`${CARD_URL}&photo=checkin%2Fu1%2Fother%3Apoint.jpg`),
      params(),
    )
    expect(res.status).toBe(200)
    // 缓存 key 不带实拍后缀：合成按无实拍处理
    expect(objects.has('og-cards/101:suga__zh__landscape.jpg')).toBe(true)
  })

  it('Browser Run 失败 → 同源代理镜像图字节，短缓存，不跨域 302，不写卡片缓存', async () => {
    const { store, objects } = makeStore()
    const res = await createGetCardHandler(
      makeDeps({ getStore: () => store, renderCard: async () => null }),
    )(get(CARD_URL, '1.2.3.4'), params())
    expect(res.status).toBe(200)
    expect(res.headers.get('location')).toBeNull()
    expect(res.headers.get('content-type')).toBe('image/jpeg')
    expect(res.headers.get('cache-control')).toBe('public, max-age=60')
    expect(Array.from(new Uint8Array(await res.arrayBuffer()))).toEqual([1, 2, 3])
    expect(objects.has('og-cards/101:suga__zh__landscape.jpg')).toBe(false)
  })

  it('镜像 404 时用 R2 静态兜底图', async () => {
    const { store } = makeStore({
      'og-cards/_fallback-landscape.jpg': new Uint8Array([5, 5, 5]),
    })
    const res = await createGetCardHandler(
      makeDeps({ getStore: () => store, renderCard: async () => null, fetchImage: async () => null }),
    )(get(CARD_URL, '1.2.3.4'), params())
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/jpeg')
    expect(res.headers.get('cache-control')).toBe('public, max-age=60')
    expect(Array.from(new Uint8Array(await res.arrayBuffer()))).toEqual([5, 5, 5])
  })

  it('连动画截图也没有 → 302 到 /opengraph-image', async () => {
    const res = await createGetCardHandler(
      makeDeps({ renderCard: async () => null, resolveAnimeImageUrl: async () => null }),
    )(get(CARD_URL, '1.2.3.4'), params())
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('https://seichigo.com/opengraph-image')
  })

  it('镜像与静态兜底图都没有 → 302 到 /opengraph-image', async () => {
    const { store } = makeStore()
    const res = await createGetCardHandler(
      makeDeps({
        getStore: () => store,
        renderCard: async () => null,
        fetchImage: async () => null,
      }),
    )(get(CARD_URL, '1.2.3.4'), params())
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('https://seichigo.com/opengraph-image')
  })

  it('点位不存在 → 404', async () => {
    const res = await createGetCardHandler(
      makeDeps({ repo: new MemoryPointContextRepo([]) }),
    )(get(CARD_URL), params())
    expect(res.status).toBe(404)
  })

  it('渲染路径抛异常时走兜底，不返 500（OG 路径永不 500）', async () => {
    const repo = new MemoryPointContextRepo([ROW])
    vi.spyOn(repo, 'findPoint').mockRejectedValue(new Error('prisma down'))
    const renderCard = vi.fn(async () => new Uint8Array([1]))
    const res = await createGetCardHandler(makeDeps({ repo, renderCard }))(
      get(CARD_URL, '1.2.3.4'),
      params(),
    )
    // 兜底路径里 loadPointContext 同样在挂，抓不到上下文 → 302 到站点默认 OG
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('https://seichigo.com/opengraph-image')
    expect(renderCard).not.toHaveBeenCalled()
  })

  it('冷路径超过 deadline 时不再等渲染，直接走兜底', async () => {
    const { store, objects } = makeStore()
    const renderCard = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1_000))
      return new Uint8Array([1])
    })
    const res = await createGetCardHandler(
      makeDeps({ getStore: () => store, renderCard, renderDeadlineMs: 50 }),
    )(get(CARD_URL, '1.2.3.4'), params())
    expect(res.status).toBe(200)
    expect(res.headers.get('location')).toBeNull()
    expect(renderCard).toHaveBeenCalled()
    expect(objects.has('og-cards/101:suga__zh__landscape.jpg')).toBe(false)
  })

  it('缓存命中不计入限流', async () => {
    const { store } = makeStore()
    const handler = createGetCardHandler(makeDeps({ getStore: () => store }))
    // 第一次未命中：渲染并写缓存，计 1 次
    expect((await handler(get(CARD_URL, '9.9.9.9'), params())).status).toBe(200)
    // 之后全部命中缓存，不该继续计数
    for (let i = 0; i < 500; i++) {
      expect((await handler(get(CARD_URL, '9.9.9.9'), params())).status).toBe(200)
    }
    // 换一个未命中的组合，仍在配额内
    expect(
      (await handler(get(`${CARD_URL.replace('layout=landscape', 'layout=portrait')}`, '9.9.9.9'), params()))
        .status,
    ).toBe(200)
  })

  it('未命中打满每日上限后 → 429', async () => {
    const { store } = makeStore()
    const handler = createGetCardHandler(makeDeps({ getStore: () => store }))
    // 用互不相同的 pointId 制造连续缓存未命中；限流闸在 404 判定之前，照常计数
    let lastStatus = 0
    for (let i = 0; i < ANON_DAILY_CARD_LIMIT; i++) {
      const pointId = `rate${i}`
      lastStatus = (
        await handler(
          get(`https://seichigo.com/api/share/card/${pointId}?locale=zh&layout=landscape`, '8.8.8.8'),
          params(pointId),
        )
      ).status
    }
    expect(lastStatus).toBe(404)
    // 配额打满后再未命中一次：直接 429，不再碰 DB / 渲染
    const res = await handler(
      get('https://seichigo.com/api/share/card/rate-final?locale=zh&layout=landscape', '8.8.8.8'),
      params('rate-final'),
    )
    expect(res.status).toBe(429)
    await expect(res.json()).resolves.toMatchObject({ error: '今日请求次数已达上限，请明天再试' })
  })

  it('日预算耗尽 → 走同源兜底且不渲染', async () => {
    const { store } = makeStore({
      'og-cards/_budget/2026-09-08.json': new TextEncoder().encode(
        JSON.stringify({ count: DAILY_RENDER_BUDGET }),
      ),
    })
    const renderCard = vi.fn(async () => new Uint8Array([1]))
    const res = await createGetCardHandler(makeDeps({ getStore: () => store, renderCard }))(
      get(CARD_URL, '1.2.3.4'),
      params(),
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('location')).toBeNull()
    expect(renderCard).not.toHaveBeenCalled()
  })

  it('渲染成功后日预算 +1', async () => {
    const { store, objects } = makeStore()
    await createGetCardHandler(makeDeps({ getStore: () => store }))(get(CARD_URL, '1.2.3.4'), params())
    const budget = objects.get('og-cards/_budget/2026-09-08.json')
    expect(new TextDecoder().decode(budget!.bytes)).toBe('{"count":1}')
  })

  it('拿不到 R2 绑定时仍能出图（不缓存）', async () => {
    const res = await createGetCardHandler(makeDeps({ getStore: () => null }))(
      get(CARD_URL),
      params(),
    )
    expect(res.status).toBe(200)
  })
})

const PATH_URL = 'https://seichigo.com/api/share/card/101%3Asuga/ja/portrait.jpg'
const segParams = (...segments: string[]) => ({ params: Promise.resolve({ segments }) })

describe('GET /api/share/card/[...segments]（路径式）', () => {
  it('三段解析 pointId/locale/layout 并按段渲染写缓存', async () => {
    const { store, objects } = makeStore()
    const res = await createGetCardHandler(makeDeps({ getStore: () => store }))(
      get(PATH_URL, '1.2.3.4'),
      segParams('101%3Asuga', 'ja', 'portrait.jpg'),
    )
    expect(res.status).toBe(200)
    expect(objects.has('og-cards/101:suga__ja__portrait.jpg')).toBe(true)
  })

  it('第 3 段不带 .jpg 后缀也能渲染', async () => {
    const { store, objects } = makeStore()
    const res = await createGetCardHandler(makeDeps({ getStore: () => store }))(
      get('https://seichigo.com/api/share/card/101%3Asuga/ja/portrait', '1.2.3.4'),
      segParams('101%3Asuga', 'ja', 'portrait'),
    )
    expect(res.status).toBe(200)
    expect(objects.has('og-cards/101:suga__ja__portrait.jpg')).toBe(true)
  })

  it('第 4 段合法哈希按无实拍渲染，缓存键与三段一致', async () => {
    const { store, objects } = makeStore()
    const res = await createGetCardHandler(makeDeps({ getStore: () => store }))(
      get('https://seichigo.com/api/share/card/101%3Asuga/zh/landscape/deadbeefcafe.jpg', '1.2.3.4'),
      segParams('101%3Asuga', 'zh', 'landscape', 'deadbeefcafe.jpg'),
    )
    expect(res.status).toBe(200)
    expect(objects.has('og-cards/101:suga__zh__landscape.jpg')).toBe(true)
  })

  it('第 4 段哈希不带 .jpg 也合法', async () => {
    const res = await createGetCardHandler(makeDeps())(
      get('https://seichigo.com/api/share/card/101%3Asuga/zh/landscape/deadbeefcafe', '1.2.3.4'),
      segParams('101%3Asuga', 'zh', 'landscape', 'deadbeefcafe'),
    )
    expect(res.status).toBe(200)
  })

  it('第 4 段哈希形状不对 → 400', async () => {
    const res = await createGetCardHandler(makeDeps())(
      get('https://seichigo.com/api/share/card/101%3Asuga/zh/landscape/not-a-hash'),
      segParams('101%3Asuga', 'zh', 'landscape', 'not-a-hash'),
    )
    expect(res.status).toBe(400)
  })

  it('locale 段非法 → 400（路径式不宽松归一）', async () => {
    const res = await createGetCardHandler(makeDeps())(
      get('https://seichigo.com/api/share/card/101%3Asuga/de/landscape.jpg'),
      segParams('101%3Asuga', 'de', 'landscape.jpg'),
    )
    expect(res.status).toBe(400)
  })

  it('layout 段非法（含 .JPG 大写后缀）→ 400', async () => {
    const square = await createGetCardHandler(makeDeps())(
      get('https://seichigo.com/api/share/card/101%3Asuga/zh/square.jpg'),
      segParams('101%3Asuga', 'zh', 'square.jpg'),
    )
    expect(square.status).toBe(400)
    const upper = await createGetCardHandler(makeDeps())(
      get('https://seichigo.com/api/share/card/101%3Asuga/zh/landscape.JPG'),
      segParams('101%3Asuga', 'zh', 'landscape.JPG'),
    )
    expect(upper.status).toBe(400)
  })

  it('段数不对（两段 / 五段）→ 400', async () => {
    const two = await createGetCardHandler(makeDeps())(
      get('https://seichigo.com/api/share/card/101%3Asuga/zh'),
      segParams('101%3Asuga', 'zh'),
    )
    expect(two.status).toBe(400)
    const five = await createGetCardHandler(makeDeps())(
      get('https://seichigo.com/api/share/card/a/zh/landscape/deadbeefcafe/extra'),
      segParams('a', 'zh', 'landscape', 'deadbeefcafe', 'extra'),
    )
    expect(five.status).toBe(400)
  })

  it('pointId 段含 .. → 400', async () => {
    const res = await createGetCardHandler(makeDeps())(
      get('https://seichigo.com/api/share/card/..%2Fetc/zh/landscape.jpg'),
      segParams('..%2Fetc', 'zh', 'landscape.jpg'),
    )
    expect(res.status).toBe(400)
  })

  it('段里畸形百分号序列 → 400 而不是 500', async () => {
    const res = await createGetCardHandler(makeDeps())(
      get('https://seichigo.com/api/share/card/%/zh/landscape.jpg'),
      segParams('%', 'zh', 'landscape.jpg'),
    )
    expect(res.status).toBe(400)
  })

  it('路径式忽略 photo 查询参数：OG 路径只走无实拍渲染', async () => {
    const { store, objects } = makeStore({
      'checkin/u1/101:suga.jpg': new Uint8Array([9, 9]),
    })
    const res = await createGetCardHandler(makeDeps({ getStore: () => store }))(
      get(
        'https://seichigo.com/api/share/card/101%3Asuga/zh/landscape.jpg?photo=checkin%2Fu1%2F101%3Asuga.jpg',
        '1.2.3.4',
      ),
      segParams('101%3Asuga', 'zh', 'landscape.jpg'),
    )
    expect(res.status).toBe(200)
    // 缓存键不带实拍后缀：按无实拍合成
    expect(objects.has('og-cards/101:suga__zh__landscape.jpg')).toBe(true)
    expect([...objects.keys()].some((key) => /__[0-9a-f]{12}\.jpg$/.test(key))).toBe(false)
  })

  it('缓存命中直接回图（路径式与查询串共用渲染与缓存路径）', async () => {
    const { store } = makeStore({
      'og-cards/101:suga__ja__portrait.jpg': new Uint8Array([4, 4]),
    })
    const renderCard = vi.fn(async () => new Uint8Array([9]))
    const res = await createGetCardHandler(makeDeps({ getStore: () => store, renderCard }))(
      get(PATH_URL),
      segParams('101%3Asuga', 'ja', 'portrait.jpg'),
    )
    expect(res.status).toBe(200)
    expect(renderCard).not.toHaveBeenCalled()
  })

  it('点位不存在 → 404（与查询串形式一致）', async () => {
    const res = await createGetCardHandler(
      makeDeps({ repo: new MemoryPointContextRepo([]) }),
    )(get(PATH_URL), segParams('101%3Asuga', 'ja', 'portrait.jpg'))
    expect(res.status).toBe(404)
  })
})
