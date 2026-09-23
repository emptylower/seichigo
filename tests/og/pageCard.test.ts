import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createGetPageCardHandler,
  FALLBACK_CACHE,
  PAGE_CARD_CACHE_CONTROL,
  PAGE_CARD_DAILY_BUDGET,
  pageCardCacheKey,
  renderAndStorePageCard,
  resetPageCardRate,
} from '@/lib/og/handlers/pageCard'
import { pageCardTextFingerprint } from '@/lib/og/pageCardHtml'
import type { ShareStore } from '@/lib/share/store'
import {
  CONTENT,
  get,
  makeDeps,
  makeStore,
  NOW,
  segParams,
  SITE_CONTENT,
  URL_BASE,
} from './pageCardTestUtils'

beforeEach(() => resetPageCardRate())

describe('pageCardCacheKey', () => {
  it('标题变化导致 ver 变化（自动换新图）', async () => {
    const a = await pageCardCacheKey('post', 'bocchi', 'zh', CONTENT, CONTENT.cover)
    const b = await pageCardCacheKey('post', 'bocchi', 'zh', { ...CONTENT, title: '改版标题' }, CONTENT.cover)
    expect(a).toMatch(/^og-pages\/post\/bocchi__zh__[0-9a-f]{12}\.jpg$/)
    expect(a).not.toBe(b)
  })

  it('封面变化同样换 ver', async () => {
    const a = await pageCardCacheKey('anime', 'bocchi', 'en', CONTENT, CONTENT.cover)
    const b = await pageCardCacheKey('anime', 'bocchi', 'en', CONTENT, null)
    expect(a).not.toBe(b)
  })

  it('i18n 文案（kind 标签/tagline）参与 ver（第 10 条）', () => {
    expect(pageCardTextFingerprint('post', 'zh')).not.toBe(pageCardTextFingerprint('post', 'ja'))
    expect(pageCardTextFingerprint('city', 'en')).not.toBe(pageCardTextFingerprint('city', 'zh'))
  })
})

describe('renderAndStorePageCard', () => {
  it('渲染成功后写进 R2，contentType image/jpeg', async () => {
    const { store, objects } = makeStore()
    const outcome = await renderAndStorePageCard(makeDeps({ getStore: () => store }), {
      kind: 'post',
      id: 'bocchi',
      locale: 'zh',
      content: CONTENT,
    })
    expect(outcome.status).toBe('rendered')
    const key = [...objects.keys()].find((k) => k.startsWith('og-pages/post/bocchi__zh__'))
    expect(key).toBeTruthy()
    expect(objects.get(key!)?.contentType).toBe('image/jpeg')
  })

  it('封面内联成 data URI 传给渲染器，HTML 里不留外链', async () => {
    const renderCard = vi.fn(
      async (_input: { html: string; width: number; height: number }) => new Uint8Array([1]),
    )
    await renderAndStorePageCard(makeDeps({ renderCard }), {
      kind: 'post',
      id: 'bocchi',
      locale: 'zh',
      content: CONTENT,
    })
    const html = renderCard.mock.calls[0]![0].html
    expect(html).toContain('data:image/jpeg;base64,')
    expect(html).not.toContain('https://image.anitabi.cn')
  })

  it('镜像抓失败时用原始绝对 URL 再抓一次（镜像对象可能尚未灌入，第 2 条）', async () => {
    const mirror = 'https://img.seichigo.com/mirror/v1/x/y.jpg'
    const fetchImage = vi.fn(async (url: string) =>
      url === mirror
        ? ({ status: 'missing' } as const)
        : ({ status: 'ok', bytes: new Uint8Array([8, 8]), contentType: 'image/jpeg' } as const),
    )
    const renderCard = vi.fn(
      async (_input: { html: string; width: number; height: number }) => new Uint8Array([1]),
    )
    const outcome = await renderAndStorePageCard(
      makeDeps({ fetchImage, renderCard, resolveAnimeImageUrl: async () => mirror }),
      { kind: 'post', id: 'bocchi', locale: 'zh', content: CONTENT },
    )
    expect(outcome.status).toBe('rendered')
    expect(fetchImage).toHaveBeenCalledTimes(2)
    expect(fetchImage).toHaveBeenNthCalledWith(1, mirror)
    expect(fetchImage).toHaveBeenNthCalledWith(2, 'https://image.anitabi.cn/points/bocchi.jpg')
    expect(renderCard.mock.calls[0]![0].html).toContain('data:image/jpeg;base64,')
  })

  it('封面两次都临时失败 → failed，不渲染、不写缓存、不耗预算（第 2 条）', async () => {
    const { store, objects } = makeStore()
    const renderCard = vi.fn(async () => new Uint8Array([1]))
    const outcome = await renderAndStorePageCard(
      makeDeps({ getStore: () => store, renderCard, fetchImage: async () => ({ status: 'transient' }) }),
      { kind: 'post', id: 'bocchi', locale: 'zh', content: CONTENT },
    )
    expect(outcome.status).toBe('failed')
    expect(renderCard).not.toHaveBeenCalled()
    // 无封面版会被长期缓存、封面恢复后也不换图——所以绝不写缓存
    expect(objects.size).toBe(0)
  })

  it('站内 /assets 封面直读资产存储，不走 HTTP（第 5 条）', async () => {
    const fetchImage = vi.fn(async () => ({ status: 'ok', bytes: new Uint8Array([1]), contentType: 'image/jpeg' }) as const)
    const readSiteAsset = vi.fn(async () => ({
      status: 'ok' as const,
      bytes: new Uint8Array([4, 4]),
      contentType: 'image/png',
    }))
    const renderCard = vi.fn(
      async (_input: { html: string; width: number; height: number }) => new Uint8Array([1]),
    )
    await renderAndStorePageCard(
      makeDeps({
        fetchImage,
        readSiteAsset,
        renderCard,
        loadContent: async () => ({ ...CONTENT, cover: '/assets/abc123' }),
      }),
      { kind: 'post', id: 'bocchi', locale: 'zh', content: { ...CONTENT, cover: '/assets/abc123' } },
    )
    expect(readSiteAsset).toHaveBeenCalledWith('abc123')
    expect(fetchImage).not.toHaveBeenCalled()
    expect(renderCard.mock.calls[0]![0].html).toContain('data:image/png;base64,')
  })

  it('缓存命中不渲染、不计预算', async () => {
    const key = await pageCardCacheKey('post', 'bocchi', 'zh', CONTENT, CONTENT.cover)
    const { store, objects } = makeStore({ [key]: new Uint8Array([7, 7, 7]) })
    const renderCard = vi.fn(async () => new Uint8Array([9]))
    const outcome = await renderAndStorePageCard(makeDeps({ getStore: () => store, renderCard }), {
      kind: 'post',
      id: 'bocchi',
      locale: 'zh',
      content: CONTENT,
    })
    expect(outcome.status).toBe('cached')
    if (outcome.status === 'cached') expect(Array.from(outcome.bytes)).toEqual([7, 7, 7])
    expect(renderCard).not.toHaveBeenCalled()
    expect([...objects.keys()].some((k) => k.includes('_budget'))).toBe(false)
  })

  it('预算耗尽直接 budget_exhausted，不再起 Browser Run', async () => {
    const { store } = makeStore({
      [`og-pages/_budget/${NOW.toISOString().slice(0, 10)}.json`]: new TextEncoder().encode(
        JSON.stringify({ count: PAGE_CARD_DAILY_BUDGET }),
      ),
    })
    const renderCard = vi.fn(async () => new Uint8Array([1]))
    const outcome = await renderAndStorePageCard(makeDeps({ getStore: () => store, renderCard }), {
      kind: 'post',
      id: 'bocchi',
      locale: 'zh',
      content: CONTENT,
    })
    expect(outcome.status).toBe('budget_exhausted')
    expect(renderCard).not.toHaveBeenCalled()
  })

  it('cacheOnly 只读缓存，未命中直接 failed 不渲染', async () => {
    const { store } = makeStore()
    const renderCard = vi.fn(async () => new Uint8Array([1]))
    const outcome = await renderAndStorePageCard(makeDeps({ getStore: () => store, renderCard }), {
      kind: 'site',
      id: 'home',
      locale: 'zh',
      content: SITE_CONTENT,
      cacheOnly: true,
    })
    expect(outcome.status).toBe('failed')
    expect(renderCard).not.toHaveBeenCalled()
  })

  it('渲染成败都计日预算（Browser Run 时长消耗与成败无关）', async () => {
    const { store, objects } = makeStore()
    await renderAndStorePageCard(makeDeps({ getStore: () => store, renderCard: async () => null }), {
      kind: 'post',
      id: 'bocchi',
      locale: 'zh',
      content: CONTENT,
    })
    const budget = objects.get(`og-pages/_budget/${NOW.toISOString().slice(0, 10)}.json`)
    expect(new TextDecoder().decode(budget!.bytes)).toBe('{"count":1}')
  })
})

describe('GET /api/og/[...segments]', () => {
  it('缓存命中直接回图（PAGE_CARD_CACHE_CONTROL），不触发渲染', async () => {
    const key = await pageCardCacheKey('post', 'bocchi', 'zh', CONTENT, CONTENT.cover)
    const { store } = makeStore({ [key]: new Uint8Array([1, 2, 3]) })
    const renderCard = vi.fn(async () => new Uint8Array([9]))
    const res = await createGetPageCardHandler(makeDeps({ getStore: () => store, renderCard }))(
      get(`${URL_BASE}/post/bocchi/zh.jpg`, '1.2.3.4'),
      segParams('post', 'bocchi', 'zh.jpg'),
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/jpeg')
    expect(res.headers.get('cache-control')).toBe(PAGE_CARD_CACHE_CONTROL)
    expect(renderCard).not.toHaveBeenCalled()
  })

  it('未命中时渲染并写入正确前缀的 key', async () => {
    const { store, objects } = makeStore()
    const res = await createGetPageCardHandler(makeDeps({ getStore: () => store }))(
      get(`${URL_BASE}/post/bocchi/en.jpg`, '1.2.3.4'),
      segParams('post', 'bocchi', 'en.jpg'),
    )
    expect(res.status).toBe(200)
    expect([...objects.keys()].some((k) => /^og-pages\/post\/bocchi__en__[0-9a-f]{12}\.jpg$/.test(k))).toBe(true)
  })

  it.each([
    ['两段', ['post', 'zh']],
    ['四段', ['post', 'bocchi', 'zh.jpg', 'extra']],
    ['kind 非法', ['video', 'bocchi', 'zh.jpg']],
    ['locale 非法', ['post', 'bocchi', 'de.jpg']],
    ['locale 段大写后缀', ['post', 'bocchi', 'zh.JPG']],
    ['site 只接受 home', ['site', 'index', 'zh.jpg']],
    ['id 含 ..', ['post', '..%2F..', 'zh.jpg']],
    ['id 含路径分隔符', ['post', 'a%2Fb', 'zh.jpg']],
    ['id 为空', ['post', '%20', 'zh.jpg']],
    ['畸形百分号序列', ['post', '%', 'zh.jpg']],
  ])('%s → 400', async (_name, segments) => {
    const res = await createGetPageCardHandler(makeDeps())(
      get(`${URL_BASE}/${segments.join('/')}`),
      segParams(...segments),
    )
    expect(res.status).toBe(400)
  })

  it('site/home 合法：渲染站点默认卡', async () => {
    const { store, objects } = makeStore()
    const res = await createGetPageCardHandler(makeDeps({ getStore: () => store }))(
      get(`${URL_BASE}/site/home/ja.jpg`, '1.2.3.4'),
      segParams('site', 'home', 'ja.jpg'),
    )
    expect(res.status).toBe(200)
    expect([...objects.keys()].some((k) => k.startsWith('og-pages/site/home__ja__'))).toBe(true)
  })

  it('locale 段不带 .jpg 后缀也合法', async () => {
    const res = await createGetPageCardHandler(makeDeps())(
      get(`${URL_BASE}/post/bocchi/zh`, '1.2.3.4'),
      segParams('post', 'bocchi', 'zh'),
    )
    expect(res.status).toBe(200)
  })

  it('内容不存在 → site/home 同 locale 兜底，不 404（③ 允许渲染，FALLBACK_CACHE）', async () => {
    const renderCard = vi.fn(async () => new Uint8Array([1]))
    const res = await createGetPageCardHandler(
      makeDeps({
        loadContent: async (kind) => (kind === 'site' ? SITE_CONTENT : null),
        renderCard,
      }),
    )(get(`${URL_BASE}/post/ghost/zh.jpg`, '1.2.3.4'), segParams('post', 'ghost', 'zh.jpg'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/jpeg')
    // 替别的 kind 顶上的 site 卡片用短缓存（第 1 条）
    expect(res.headers.get('cache-control')).toBe(FALLBACK_CACHE)
    // 原卡不渲染，只起一次 site/home 兜底渲染
    expect(renderCard).toHaveBeenCalledTimes(1)
  })

  it('渲染返回 null → ① 转发封面字节（同源、FALLBACK_CACHE、不 302）', async () => {
    const res = await createGetPageCardHandler(makeDeps({ renderCard: async () => null }))(
      get(`${URL_BASE}/post/bocchi/zh.jpg`, '1.2.3.4'),
      segParams('post', 'bocchi', 'zh.jpg'),
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('location')).toBeNull()
    expect(res.headers.get('content-type')).toBe('image/jpeg')
    expect(res.headers.get('cache-control')).toBe(FALLBACK_CACHE)
    expect(Array.from(new Uint8Array(await res.arrayBuffer()))).toEqual([1, 2, 3])
  })

  it('① 只转发位图：svg 封面不代理，跳到后续兜底（第 7 条）', async () => {
    const { store } = makeStore()
    const handler = createGetPageCardHandler(makeDeps({ getStore: () => store }))
    for (let i = 0; i < 10; i++) {
      await handler(
        get(`${URL_BASE}/post/p${i}/zh.jpg`, '8.8.8.8'),
        segParams('post', `p${i}`, 'zh.jpg'),
      )
    }
    // 第 11 次未命中被限流 → 兜底 ①：封面是 svg，白名单不放行（放行就是
    // 200 + image/svg+xml）→ ② 没有 → ③ 只读缓存未命中 → 503 no-store
    const res = await createGetPageCardHandler(
      makeDeps({
        getStore: () => store,
        fetchImage: async () => ({ status: 'ok', bytes: new Uint8Array([2, 2]), contentType: 'image/svg+xml' }),
      }),
    )(get(`${URL_BASE}/post/p-final/zh.jpg`, '8.8.8.8'), segParams('post', 'p-final', 'zh.jpg'))
    expect(res.status).toBe(503)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('① 的站内 /assets 封面直读资产存储，不走 HTTP（第 5 条）', async () => {
    const fetchImage = vi.fn(async () => ({ status: 'ok', bytes: new Uint8Array([1]), contentType: 'image/jpeg' }) as const)
    const readSiteAsset = vi.fn(async () => ({
      status: 'ok' as const,
      bytes: new Uint8Array([4, 4]),
      contentType: 'image/png',
    }))
    const res = await createGetPageCardHandler(
      makeDeps({
        renderCard: async () => null,
        fetchImage,
        readSiteAsset,
        loadContent: async () => ({ ...CONTENT, cover: '/assets/abc123' }),
      }),
    )(get(`${URL_BASE}/post/bocchi/zh.jpg`, '1.2.3.4'), segParams('post', 'bocchi', 'zh.jpg'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    expect(res.headers.get('cache-control')).toBe(FALLBACK_CACHE)
    expect(Array.from(new Uint8Array(await res.arrayBuffer()))).toEqual([4, 4])
    expect(readSiteAsset).toHaveBeenCalledWith('abc123')
    expect(fetchImage).not.toHaveBeenCalled()
  })

  it('无封面时读 R2 _fallback（兜底链 ②，FALLBACK_CACHE）', async () => {
    const noCover = { ...CONTENT, cover: null }
    const r2 = makeStore({ 'og-pages/_fallback.jpg': new Uint8Array([5, 5, 5]) })
    const res = await createGetPageCardHandler(
      makeDeps({ getStore: () => r2.store, renderCard: async () => null, loadContent: async () => noCover }),
    )(get(`${URL_BASE}/post/bocchi/zh.jpg`, '1.2.3.4'), segParams('post', 'bocchi', 'zh.jpg'))
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe(FALLBACK_CACHE)
    expect(Array.from(new Uint8Array(await res.arrayBuffer()))).toEqual([5, 5, 5])
  })

  it('② 的 R2 读流异常不抛 500，继续走 ③（第 8 条）', async () => {
    const { store } = makeStore({ 'og-pages/_fallback.jpg': new Uint8Array([5, 5, 5]) })
    const brokenStore: ShareStore = {
      ...store,
      async get(key) {
        const found = await store.get(key)
        if (found && key === 'og-pages/_fallback.jpg') {
          return {
            ...found,
            body: new ReadableStream<Uint8Array>({
              start(controller) {
                controller.error(new Error('r2 stream broken'))
              },
            }),
          }
        }
        return found
      },
    }
    const renderCard = vi.fn(async () => new Uint8Array([8, 8]))
    const res = await createGetPageCardHandler(
      makeDeps({
        getStore: () => brokenStore,
        renderCard,
        loadContent: async (kind) => (kind === 'site' ? SITE_CONTENT : null),
      }),
    )(get(`${URL_BASE}/post/bocchi/zh.jpg`, '1.2.3.4'), segParams('post', 'bocchi', 'zh.jpg'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/jpeg')
    expect(Array.from(new Uint8Array(await res.arrayBuffer()))).toEqual([8, 8])
  })

  it('③ 未命中且预算允许就渲染一次 site/home 卡（FALLBACK_CACHE）', async () => {
    const { store, objects } = makeStore()
    const renderCard = vi.fn(async () => new Uint8Array([9, 9, 9]))
    const res = await createGetPageCardHandler(
      makeDeps({
        getStore: () => store,
        renderCard,
        loadContent: async (kind) => (kind === 'site' ? SITE_CONTENT : null),
      }),
    )(get(`${URL_BASE}/post/bocchi/zh.jpg`, '1.2.3.4'), segParams('post', 'bocchi', 'zh.jpg'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/jpeg')
    expect(res.headers.get('cache-control')).toBe(FALLBACK_CACHE)
    expect(Array.from(new Uint8Array(await res.arrayBuffer()))).toEqual([9, 9, 9])
    expect(renderCard).toHaveBeenCalledTimes(1)
    expect([...objects.keys()].some((k) => k.startsWith('og-pages/site/home__zh__'))).toBe(true)
  })

  it('主渲染失败后 ③ 只读缓存：命中直接回，不再渲染（第 3 条）', async () => {
    const siteKey = await pageCardCacheKey('site', 'home', 'zh', SITE_CONTENT, null)
    const { store } = makeStore({ [siteKey]: new Uint8Array([6, 6]) })
    const noCover = { ...CONTENT, cover: null }
    const renderCard = vi
      .fn(
        async (_input: {
          html: string
          width: number
          height: number
        }): Promise<Uint8Array<ArrayBuffer> | null> => new Uint8Array([1]),
      )
      .mockResolvedValueOnce(null)
    const res = await createGetPageCardHandler(
      makeDeps({
        getStore: () => store,
        renderCard,
        loadContent: async (kind) => (kind === 'site' ? SITE_CONTENT : noCover),
      }),
    )(get(`${URL_BASE}/post/bocchi/zh.jpg`, '1.2.3.4'), segParams('post', 'bocchi', 'zh.jpg'))
    expect(res.status).toBe(200)
    expect(Array.from(new Uint8Array(await res.arrayBuffer()))).toEqual([6, 6])
    // 主渲染失败一次后，site 卡走缓存不再起第二次渲染
    expect(renderCard).toHaveBeenCalledTimes(1)
  })

  it('总预算耗尽后 ③ 只读缓存，未命中 → 503 no-store（第 3 条）', async () => {
    const renderCard = vi.fn(async () => new Uint8Array([1]))
    const res = await createGetPageCardHandler(
      makeDeps({
        renderCard,
        totalBudgetMs: 0,
        loadContent: async (kind) => (kind === 'site' ? SITE_CONTENT : null),
      }),
    )(get(`${URL_BASE}/post/bocchi/zh.jpg`, '1.2.3.4'), segParams('post', 'bocchi', 'zh.jpg'))
    expect(res.status).toBe(503)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(renderCard).not.toHaveBeenCalled()
  })

  it('限流后走兜底不再 429；无封面时 ③ 只读缓存不渲染 → 503（第 4 条）', async () => {
    const { store } = makeStore()
    const handler = createGetPageCardHandler(makeDeps({ getStore: () => store }))
    // 用互不相同的 id 制造连续未命中打满每分钟上限
    for (let i = 0; i < 10; i++) {
      const status = (
        await handler(
          get(`${URL_BASE}/post/p${i}/zh.jpg`, '8.8.8.8'),
          segParams('post', `p${i}`, 'zh.jpg'),
        )
      ).status
      expect(status).toBe(200)
    }
    // 第 11 次未命中（无封面的内容）：限流 → 兜底 ①② 都没有 → ③ 只读缓存 → 503
    const renderCard = vi.fn(async () => new Uint8Array([1]))
    const noCover = { ...CONTENT, cover: null }
    const res = await createGetPageCardHandler(
      makeDeps({
        getStore: () => store,
        renderCard,
        loadContent: async (kind) => (kind === 'site' ? SITE_CONTENT : noCover),
      }),
    )(get(`${URL_BASE}/post/p-final/zh.jpg`, '8.8.8.8'), segParams('post', 'p-final', 'zh.jpg'))
    expect(res.status).toBe(503)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(renderCard).not.toHaveBeenCalled()
  })

  it('限流的 post 请求走 ① 封面代理回图，不再 429（第 4 条）', async () => {
    const { store } = makeStore()
    const handler = createGetPageCardHandler(makeDeps({ getStore: () => store }))
    for (let i = 0; i < 10; i++) {
      await handler(
        get(`${URL_BASE}/post/p${i}/zh.jpg`, '8.8.8.8'),
        segParams('post', `p${i}`, 'zh.jpg'),
      )
    }
    const res = await handler(
      get(`${URL_BASE}/post/p-final/zh.jpg`, '8.8.8.8'),
      segParams('post', 'p-final', 'zh.jpg'),
    )
    // CONTENT 有封面：限流后兜底 ① 直接代理封面字节
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/jpeg')
    expect(res.headers.get('cache-control')).toBe(FALLBACK_CACHE)
  })

  it('site/home 请求兜底命中 R2 _fallback（中文图）也只用 FALLBACK_CACHE（7-3）', async () => {
    const { store } = makeStore({
      [`og-pages/_budget/${NOW.toISOString().slice(0, 10)}.json`]: new TextEncoder().encode(
        JSON.stringify({ count: PAGE_CARD_DAILY_BUDGET }),
      ),
      'og-pages/_fallback.jpg': new Uint8Array([5, 5, 5]),
    })
    const renderCard = vi.fn(async () => new Uint8Array([1]))
    const res = await createGetPageCardHandler(
      makeDeps({ getStore: () => store, renderCard, loadContent: async () => SITE_CONTENT }),
    )(get(`${URL_BASE}/site/home/zh.jpg`, '1.2.3.4'), segParams('site', 'home', 'zh.jpg'))
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe(FALLBACK_CACHE)
    expect(Array.from(new Uint8Array(await res.arrayBuffer()))).toEqual([5, 5, 5])
    expect(renderCard).not.toHaveBeenCalled()
  })

  it('site/home 请求失败后不再渲染一次自己：缓存也没有 → 503（第 3 条）', async () => {
    const { store } = makeStore()
    const renderCard = vi.fn(async () => null)
    const res = await createGetPageCardHandler(
      makeDeps({ getStore: () => store, renderCard, loadContent: async () => SITE_CONTENT }),
    )(get(`${URL_BASE}/site/home/zh.jpg`, '1.2.3.4'), segParams('site', 'home', 'zh.jpg'))
    expect(res.status).toBe(503)
    expect(res.headers.get('cache-control')).toBe('no-store')
    // 主渲染一次（失败），兜底③不再渲染自己
    expect(renderCard).toHaveBeenCalledTimes(1)
  })

  it('预算耗尽走兜底且不渲染', async () => {
    const { store } = makeStore({
      [`og-pages/_budget/${NOW.toISOString().slice(0, 10)}.json`]: new TextEncoder().encode(
        JSON.stringify({ count: PAGE_CARD_DAILY_BUDGET }),
      ),
    })
    const renderCard = vi.fn(async () => new Uint8Array([1]))
    const res = await createGetPageCardHandler(makeDeps({ getStore: () => store, renderCard }))(
      get(`${URL_BASE}/post/bocchi/zh.jpg`, '1.2.3.4'),
      segParams('post', 'bocchi', 'zh.jpg'),
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('location')).toBeNull()
    expect(renderCard).not.toHaveBeenCalled()
  })

  it('冷路径超过 deadline 时不再等渲染，直接走兜底；落败渲染登记 waitUntil（第 3 条）', async () => {
    const { store, objects } = makeStore()
    const renderCard = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1_000))
      return new Uint8Array([1])
    })
    const waitUntil = vi.fn()
    const res = await createGetPageCardHandler(
      makeDeps({ getStore: () => store, renderCard, renderDeadlineMs: 50, bindWaitUntil: () => waitUntil }),
    )(get(`${URL_BASE}/post/bocchi/zh.jpg`, '1.2.3.4'), segParams('post', 'bocchi', 'zh.jpg'))
    expect(res.status).toBe(200)
    expect(res.headers.get('location')).toBeNull()
    expect(renderCard).toHaveBeenCalled()
    // ① 封面代理回的字节
    expect(Array.from(new Uint8Array(await res.arrayBuffer()))).toEqual([1, 2, 3])
    // 落败的渲染被登记进 waitUntil（Cloudflare 上靠它把缓存写完）
    expect(waitUntil).toHaveBeenCalledTimes(1)
    expect([...objects.keys()].some((k) => k.startsWith('og-pages/post/bocchi__zh__'))).toBe(false)
  })

  it('渲染路径抛异常时走兜底，不返 500（OG 路径永不 500）', async () => {
    const res = await createGetPageCardHandler(
      makeDeps({
        loadContent: async (kind) => {
          if (kind === 'site') return SITE_CONTENT
          throw new Error('prisma down')
        },
      }),
    )(get(`${URL_BASE}/post/bocchi/zh.jpg`, '1.2.3.4'), segParams('post', 'bocchi', 'zh.jpg'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/jpeg')
  })

  it('兜底链 ④：封面、R2、site 渲染全失败 → 503 + no-store（不出 SVG、不 302）', async () => {
    const noCover = { ...CONTENT, cover: null }
    const res = await createGetPageCardHandler(
      makeDeps({ renderCard: async () => null, loadContent: async () => noCover }),
    )(get(`${URL_BASE}/post/bocchi/zh.jpg`, '1.2.3.4'), segParams('post', 'bocchi', 'zh.jpg'))
    expect(res.status).toBe(503)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('location')).toBeNull()
  })
})
