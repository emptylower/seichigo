import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createGetPageCardHandler,
  FALLBACK_CACHE,
  PAGE_CARD_CACHE_CONTROL,
  PAGE_CARD_DAILY_BUDGET,
  pageCardCacheKey,
  r2ThenSiteCardResponse,
  renderAndStorePageCard,
  resetPageCardRate,
} from '@/lib/og/handlers/pageCard'
import { createSiteAssetReader, OG_COVER_VARIANT } from '@/lib/og/siteAsset'
import { InMemoryAssetRepo } from '@/lib/asset/repoMemory'
import type { AssetStore } from '@/lib/asset/store'
import { MAX_INLINE_IMAGE_BYTES } from '@/lib/share/handlers/card'
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

/** 第二轮评审（计划第 7 节）：封面永久/临时失败、兜底①预算、② 缓存头、waitUntil 绑定 */

beforeEach(() => resetPageCardRate())

type RenderInput = { html: string; width: number; height: number }

describe('封面永久失败 vs 临时失败（7-1）', () => {
  it('404 永久失败 → 渲染无封面卡，按无封面 ver 写缓存；下次直接命中不再渲染', async () => {
    const { store, objects } = makeStore()
    const renderCard = vi.fn(async (_input: RenderInput) => new Uint8Array([3, 3]))
    const fetchImage = vi.fn(async () => ({ status: 'missing' }) as const)
    const deps = makeDeps({ getStore: () => store, renderCard, fetchImage })
    const input = { kind: 'post', id: 'bocchi', locale: 'zh', content: CONTENT } as const

    const first = await renderAndStorePageCard(deps, input)
    expect(first.status).toBe('rendered')
    expect(renderCard.mock.calls[0]![0].html).not.toContain('data:image/')
    const coverlessKey = await pageCardCacheKey('post', 'bocchi', 'zh', CONTENT, null)
    const coveredKey = await pageCardCacheKey('post', 'bocchi', 'zh', CONTENT, CONTENT.cover)
    expect(objects.has(coverlessKey)).toBe(true)
    expect(objects.has(coveredKey)).toBe(false)

    // 带封面的 key 仍未命中 → 重抓封面（封面修好就能换新）；仍 missing 则命中无封面缓存
    const second = await renderAndStorePageCard(deps, input)
    expect(second.status).toBe('cached')
    expect(renderCard).toHaveBeenCalledTimes(1)
    expect(fetchImage).toHaveBeenCalledTimes(2)
  })

  it('封面修好后带封面 key 未命中 → 重新渲染带封面版', async () => {
    const coverlessKey = await pageCardCacheKey('post', 'bocchi', 'zh', CONTENT, null)
    const { store, objects } = makeStore({ [coverlessKey]: new Uint8Array([3]) })
    const renderCard = vi.fn(async (_input: RenderInput) => new Uint8Array([4]))
    const outcome = await renderAndStorePageCard(makeDeps({ getStore: () => store, renderCard }), {
      kind: 'post',
      id: 'bocchi',
      locale: 'zh',
      content: CONTENT,
    })
    expect(outcome.status).toBe('rendered')
    expect(renderCard.mock.calls[0]![0].html).toContain('data:image/jpeg;base64,')
    expect(objects.has(await pageCardCacheKey('post', 'bocchi', 'zh', CONTENT, CONTENT.cover))).toBe(true)
  })

  it('镜像临时失败 + 原图 404 → 仍按临时失败处理（不缓存无封面卡）', async () => {
    const { store, objects } = makeStore()
    const mirror = 'https://img.seichigo.com/mirror/v1/x/y.jpg'
    const renderCard = vi.fn(async () => new Uint8Array([1]))
    const outcome = await renderAndStorePageCard(
      makeDeps({
        getStore: () => store,
        renderCard,
        resolveAnimeImageUrl: async () => mirror,
        fetchImage: async (url) => (url === mirror ? { status: 'transient' } : { status: 'missing' }),
      }),
      { kind: 'post', id: 'bocchi', locale: 'zh', content: CONTENT },
    )
    expect(outcome).toEqual({ status: 'failed', reason: 'cover' })
    expect(renderCard).not.toHaveBeenCalled()
    expect(objects.size).toBe(0)
  })

  it('超时临时失败 → 请求走兜底、不写页面卡缓存，且兜底①不再抓封面（7-2）', async () => {
    const { store, objects } = makeStore({ 'og-pages/_fallback.jpg': new Uint8Array([5, 5]) })
    const renderCard = vi.fn(async () => new Uint8Array([1]))
    const fetchImage = vi.fn(async () => ({ status: 'transient' }) as const)
    const res = await createGetPageCardHandler(
      makeDeps({ getStore: () => store, renderCard, fetchImage }),
    )(get(`${URL_BASE}/post/bocchi/zh.jpg`, '1.2.3.4'), segParams('post', 'bocchi', 'zh.jpg'))
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe(FALLBACK_CACHE)
    expect(Array.from(new Uint8Array(await res.arrayBuffer()))).toEqual([5, 5])
    // 只有主渲染抓过一次；①因为失败原因就是封面而被跳过
    expect(fetchImage).toHaveBeenCalledTimes(1)
    expect(renderCard).not.toHaveBeenCalled()
    expect([...objects.keys()].some((k) => k.startsWith('og-pages/post/'))).toBe(false)
  })
})

describe('兜底①受总预算约束（7-2）', () => {
  it('剩余预算不足 1.5 秒直接跳过①', async () => {
    const { store } = makeStore({ 'og-pages/_fallback.jpg': new Uint8Array([5]) })
    const fetchImage = vi.fn(async () => ({
      status: 'ok' as const,
      bytes: new Uint8Array([1]),
      contentType: 'image/jpeg',
    }))
    const res = await createGetPageCardHandler(
      makeDeps({ getStore: () => store, renderCard: async () => null, fetchImage, totalBudgetMs: 1_000 }),
    )(get(`${URL_BASE}/post/bocchi/zh.jpg`, '1.2.3.4'), segParams('post', 'bocchi', 'zh.jpg'))
    expect(Array.from(new Uint8Array(await res.arrayBuffer()))).toEqual([5])
    // 主渲染抓了一次封面；①被跳过
    expect(fetchImage).toHaveBeenCalledTimes(1)
  })

  it('①抓取超过剩余预算 → race 落败，继续走②', async () => {
    const { store } = makeStore({ 'og-pages/_fallback.jpg': new Uint8Array([5]) })
    let calls = 0
    const fetchImage = vi.fn(async () => {
      calls += 1
      if (calls > 1) await new Promise((resolve) => setTimeout(resolve, 5_000))
      return { status: 'ok' as const, bytes: new Uint8Array([1]), contentType: 'image/jpeg' }
    })
    const startedAt = Date.now()
    const res = await createGetPageCardHandler(
      makeDeps({ getStore: () => store, renderCard: async () => null, fetchImage, totalBudgetMs: 1_600 }),
    )(get(`${URL_BASE}/post/bocchi/zh.jpg`, '1.2.3.4'), segParams('post', 'bocchi', 'zh.jpg'))
    expect(Date.now() - startedAt).toBeLessThan(3_000)
    expect(res.headers.get('cache-control')).toBe(FALLBACK_CACHE)
    expect(Array.from(new Uint8Array(await res.arrayBuffer()))).toEqual([5])
  })
})

describe('② R2 _fallback 缓存头（7-3）', () => {
  it('site/home/en 自身失败命中 R2 中文兜底图 → FALLBACK_CACHE', async () => {
    const { store } = makeStore({ 'og-pages/_fallback.jpg': new Uint8Array([5]) })
    const res = await createGetPageCardHandler(
      makeDeps({ getStore: () => store, renderCard: async () => null, loadContent: async () => SITE_CONTENT }),
    )(get(`${URL_BASE}/site/home/en.jpg`, '1.2.3.4'), segParams('site', 'home', 'en.jpg'))
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe(FALLBACK_CACHE)
  })

  it('③ 真正拿到同 locale site/home 卡才用长缓存；② 只在显式传 r2CacheControl 时长缓存', async () => {
    const siteKey = await pageCardCacheKey('site', 'home', 'ja', SITE_CONTENT, null)
    const withSite = makeStore({ [siteKey]: new Uint8Array([6]) })
    const deps = makeDeps({ getStore: () => withSite.store, loadContent: async () => SITE_CONTENT })
    const viaSite = await r2ThenSiteCardResponse(deps, 'ja', {
      cacheControl: PAGE_CARD_CACHE_CONTROL,
      allowRender: false,
    })
    expect(viaSite.headers.get('cache-control')).toBe(PAGE_CARD_CACHE_CONTROL)

    const withR2 = makeStore({ 'og-pages/_fallback.jpg': new Uint8Array([5]) })
    const r2Deps = makeDeps({ getStore: () => withR2.store })
    const byDefault = await r2ThenSiteCardResponse(r2Deps, 'ja', { cacheControl: PAGE_CARD_CACHE_CONTROL })
    expect(byDefault.headers.get('cache-control')).toBe(FALLBACK_CACHE)
    // /opengraph-image 本身就是中文：显式允许 ② 长缓存
    const ogImage = await r2ThenSiteCardResponse(r2Deps, 'zh', {
      cacheControl: PAGE_CARD_CACHE_CONTROL,
      r2CacheControl: PAGE_CARD_CACHE_CONTROL,
    })
    expect(ogImage.headers.get('cache-control')).toBe(PAGE_CARD_CACHE_CONTROL)
  })
})

describe('waitUntil 在请求开始时绑定（7-5）', () => {
  it('bindWaitUntil 在渲染开始前只调用一次，deadline 回调里用的是绑好的函数', async () => {
    const order: string[] = []
    const waitUntil = vi.fn()
    const bindWaitUntil = vi.fn(() => {
      order.push('bind')
      return waitUntil
    })
    const renderCard = vi.fn(async () => {
      order.push('render')
      await new Promise((resolve) => setTimeout(resolve, 300))
      return new Uint8Array([1])
    })
    await createGetPageCardHandler(
      makeDeps({ renderCard, renderDeadlineMs: 20, bindWaitUntil }),
    )(get(`${URL_BASE}/post/bocchi/zh.jpg`, '1.2.3.4'), segParams('post', 'bocchi', 'zh.jpg'))
    expect(bindWaitUntil).toHaveBeenCalledTimes(1)
    expect(order[0]).toBe('bind')
    expect(waitUntil).toHaveBeenCalledTimes(1)
    expect(waitUntil.mock.calls[0]![0]).toBeInstanceOf(Promise)
  })
})

describe('主路径兜底 ③ 只读缓存（7-6）', () => {
  it('预算耗尽 + 无封面 → ③ 不渲染，site 缓存也没有 → 503', async () => {
    const { store } = makeStore({
      [`og-pages/_budget/${NOW.toISOString().slice(0, 10)}.json`]: new TextEncoder().encode(
        JSON.stringify({ count: PAGE_CARD_DAILY_BUDGET }),
      ),
    })
    const renderCard = vi.fn(async () => new Uint8Array([1]))
    const res = await createGetPageCardHandler(
      makeDeps({
        getStore: () => store,
        renderCard,
        loadContent: async (kind) => (kind === 'site' ? SITE_CONTENT : { ...CONTENT, cover: null }),
      }),
    )(get(`${URL_BASE}/post/bocchi/zh.jpg`, '1.2.3.4'), segParams('post', 'bocchi', 'zh.jpg'))
    expect(res.status).toBe(503)
    expect(renderCard).not.toHaveBeenCalled()
  })
})

describe('站内 /assets 封面直读（7-1、7-4）', () => {
  function makeAssetStore(variants: Record<string, Uint8Array> = {}) {
    const getOriginal = vi.fn(async () => null)
    const store: AssetStore = {
      async putOriginal() {},
      getOriginal,
      async getVariant(id, width, quality) {
        const bytes = variants[`${id}:${width}:${quality}`]
        if (!bytes) return null
        return {
          body: new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(bytes)
              controller.close()
            },
          }),
          size: bytes.byteLength,
        }
      },
      async putVariant() {},
    }
    return { store, getOriginal }
  }

  async function seedAsset(contentType: string, byteLength: number | null, bytes = new Uint8Array([1, 2])) {
    const repo = new InMemoryAssetRepo({ idFactory: () => 'a1' })
    await repo.create({ ownerId: 'u', contentType, bytes, byteLength, storageKey: 'originals/a1' })
    const findBytesById = vi.spyOn(repo, 'findBytesById')
    return { repo, findBytesById }
  }

  it('超大原图有变体时用变体（image/webp），不读原图字节', async () => {
    const { repo, findBytesById } = await seedAsset('image/png', MAX_INLINE_IMAGE_BYTES + 1)
    const variant = new Uint8Array([9, 9, 9])
    const { store, getOriginal } = makeAssetStore({
      [`a1:${OG_COVER_VARIANT.width}:${OG_COVER_VARIANT.quality}`]: variant,
    })
    const result = await createSiteAssetReader({ getRepo: () => repo, getStore: () => store })('a1')
    expect(result).toEqual({ status: 'ok', bytes: variant, contentType: 'image/webp' })
    expect(getOriginal).not.toHaveBeenCalled()
    expect(findBytesById).not.toHaveBeenCalled()
  })

  it('超大原图且无变体（GIF 不可转换）→ 永久失败，先看 byteLength 不读字节', async () => {
    const { repo, findBytesById } = await seedAsset('image/gif', MAX_INLINE_IMAGE_BYTES + 1)
    const { store, getOriginal } = makeAssetStore()
    const result = await createSiteAssetReader({ getRepo: () => repo, getStore: () => store })('a1')
    expect(result).toEqual({ status: 'missing' })
    expect(getOriginal).not.toHaveBeenCalled()
    expect(findBytesById).not.toHaveBeenCalled()
  })

  it('资产不存在 → missing；heic 等浏览器解不了的类型 → missing（7-4）', async () => {
    const { repo } = await seedAsset('image/heic', 10)
    const reader = createSiteAssetReader({ getRepo: () => repo, getStore: () => null })
    expect(await reader('nope')).toEqual({ status: 'missing' })
    expect(await reader('a1')).toEqual({ status: 'missing' })
  })

  it('小 GIF 原图直接内联；数据库抛错算临时失败', async () => {
    const { repo } = await seedAsset('image/gif', 2)
    const ok = await createSiteAssetReader({ getRepo: () => repo, getStore: () => null })('a1')
    expect(ok.status).toBe('ok')
    if (ok.status === 'ok') expect(ok.contentType).toBe('image/gif')

    const broken = createSiteAssetReader({
      getRepo: () => {
        throw new Error('db down')
      },
      getStore: () => null,
    })
    expect(await broken('a1')).toEqual({ status: 'transient' })
  })
})
