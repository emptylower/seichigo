import type { SupportedLocale } from '@/lib/i18n/types'
import { NextResponse } from 'next/server'
import {
  buildPageCardHtml,
  pageCardTextFingerprint,
  PAGE_CARD_HEIGHT,
  PAGE_CARD_WIDTH,
  type PageCardKind,
} from '@/lib/og/pageCardHtml'
import type { PageCardContent } from '@/lib/og/pageCardContent'
import {
  normalizeImageContentType,
  PROXY_SAFE_IMAGE_PATTERN,
  type CoverImageResult,
} from '@/lib/og/coverImage'
import { hashIp, readClientIp, utcDateStamp } from '@/lib/share/ipHash'
import { toDataUri } from '@/lib/share/handlers/card'
import { readAllBytes, type ShareStore } from '@/lib/share/store'

/** 页面卡片全局日预算：独立于点位卡片（og-cards/_budget），只防 Browser Run 跑飞 */
export const PAGE_CARD_DAILY_BUDGET = 1500

/** 版式改动（pageCardHtml 的布局/字号/配色）时手动 +1，让全部缓存键换血 */
export const TEMPLATE_VERSION = 1

/** 匿名每 IP 每分钟最多 10 次未命中渲染：爬虫天然匿名，只防刷不挡正常抓取 */
export const ANON_PAGE_CARD_PER_MINUTE = 10

/**
 * 请求路径冷路径软 deadline：内容查找 + 抓封面 + Browser Run 最坏可跑到
 * 20 秒外，社媒爬虫会超时放弃「无预览」。落败的渲染在后台继续写缓存，
 * 下次请求就命中了（与 lib/share/handlers/card.ts 的 COLD_PATH_DEADLINE_MS 同思路）。
 */
export const PAGE_CARD_COLD_DEADLINE_MS = 8_000

/**
 * 单请求总预算（主渲染 + 兜底链）：社媒爬虫普遍 10 秒级超时，主渲染 8 秒
 * 落败后兜底只剩读缓存/转发，不再发起第二次 Browser Run。
 */
export const PAGE_CARD_TOTAL_BUDGET_MS = 9_000

/** URL 里没有 ver 段，内容变化时同一 URL 要能刷新：不能 immutable */
export const PAGE_CARD_CACHE_CONTROL =
  'public, max-age=86400, s-maxage=604800, stale-while-revalidate=604800'

/** 失败兜底不写缓存，公共缓存只敢放 60 秒 */
export const FALLBACK_CACHE = 'public, max-age=60'

/** 静态兜底图 key：上线后调生产 /api/og/site/home/zh.jpg 渲染再上传到 ASSET_STORE；仓库不放静态兜底图 */
const R2_FALLBACK_KEY = 'og-pages/_fallback.jpg'

/**
 * 兜底①（转发封面字节）至少要留的剩余预算：不足就直接跳过①，别让一次慢抓取
 * 把整条链拖出 9 秒总预算（②③ 只是读 R2，很快）。
 */
export const COVER_PROXY_MIN_REMAINING_MS = 1_500

export type PageCardDeps = {
  /** 每次请求现取：R2 绑定挂在 per-request 的 cloudflare context 上 */
  getStore: () => ShareStore | null
  renderCard: (input: {
    html: string
    width: number
    height: number
  }) => Promise<Uint8Array<ArrayBuffer> | null>
  /** 外部封面抓取：区分 ok / missing（永久）/ transient（临时），见 lib/og/coverImage.ts */
  fetchImage: (url: string) => Promise<CoverImageResult>
  /** anitabi 封面 → R2 镜像公共域 URL（resolveMirrorPublicUrl） */
  resolveAnimeImageUrl: (rawUrl: string) => Promise<string | null>
  loadContent: (kind: PageCardKind, id: string, locale: SupportedLocale) => Promise<PageCardContent | null>
  /** 站内 `/assets/<id>` 封面直读（不走 HTTP，见 lib/og/siteAsset.ts）；缺省视为读不到 */
  readSiteAsset?: (assetId: string) => Promise<CoverImageResult>
  /**
   * 请求开始时调用一次，返回绑定好 ctx 的 waitUntil 登记函数（登记「落败但仍在
   * 后台跑」的渲染）。不能等到 deadline 的 setTimeout 回调里再现取 ctx。
   * 本地/测试拿不到 ctx 时返回 null（或缺省），即忽略。
   */
  bindWaitUntil?: () => ((promise: Promise<unknown>) => void) | null
  now: () => Date
  origin: string
  /** 请求路径 deadline 覆盖（单测用）；缺省 PAGE_CARD_COLD_DEADLINE_MS */
  renderDeadlineMs?: number
  /** 单请求总预算覆盖（单测用）；缺省 PAGE_CARD_TOTAL_BUDGET_MS */
  totalBudgetMs?: number
}

const PATH_KINDS: readonly PageCardKind[] = ['post', 'anime', 'city', 'site']
const PATH_LOCALES: readonly string[] = ['zh', 'en', 'ja']

async function sha256Hex(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  let hex = ''
  for (const byte of new Uint8Array(digest)) hex += byte.toString(16).padStart(2, '0')
  return hex
}

/**
 * `og-pages/<kind>/<id>__<locale>__<ver>.jpg`，ver = sha256(
 * TEMPLATE_VERSION|文案指纹|title|subtitle|coverUrl) 前 12 位。文案指纹是
 * kind 标签 + tagline 的实际译文：改 i18n 词条自动换图；标题或封面一改也换。
 */
export async function pageCardCacheKey(
  kind: PageCardKind,
  id: string,
  locale: SupportedLocale,
  content: Pick<PageCardContent, 'title' | 'subtitle'>,
  coverUrl: string | null,
): Promise<string> {
  const material = [
    TEMPLATE_VERSION,
    pageCardTextFingerprint(kind, locale),
    content.title,
    content.subtitle ?? '',
    coverUrl ?? '',
  ].join('|')
  const ver = (await sha256Hex(material)).slice(0, 12)
  return `og-pages/${kind}/${id}__${locale}__${ver}.jpg`
}

type RateEntry = { minute: number; count: number }
const rateCounters = new Map<string, RateEntry>()

/** isolate 内每 IP 每分钟计数（与 lib/share/cardBudget.ts 同一套取舍） */
export function checkPageCardRate(ipHash: string, now: Date): boolean {
  const minute = Math.floor(now.getTime() / 60_000)
  const entry = rateCounters.get(ipHash)
  if (!entry || entry.minute !== minute) {
    if (rateCounters.size > 5000) rateCounters.clear()
    rateCounters.set(ipHash, { minute, count: 1 })
    return true
  }
  if (entry.count >= ANON_PAGE_CARD_PER_MINUTE) return false
  entry.count += 1
  return true
}

/** 单测隔离用 */
export function resetPageCardRate(): void {
  rateCounters.clear()
}

/** 独立计数前缀，不与点位卡片（og-cards/_budget）共用额度 */
function pageCardBudgetKey(now: Date): string {
  return `og-pages/_budget/${utcDateStamp(now)}.json`
}

async function readPageCardBudget(store: ShareStore, now: Date): Promise<number> {
  try {
    const object = await store.get(pageCardBudgetKey(now))
    if (!object) return 0
    const parsed = JSON.parse(new TextDecoder().decode(await readAllBytes(object.body))) as {
      count?: unknown
    }
    const count = Number(parsed?.count)
    return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0
  } catch {
    return 0
  }
}

async function bumpPageCardBudget(store: ShareStore, now: Date): Promise<void> {
  const next = (await readPageCardBudget(store, now)) + 1
  const bytes = new TextEncoder().encode(JSON.stringify({ count: next }))
  await store.put(pageCardBudgetKey(now), bytes, 'application/json')
}

type CoverParts = { original: string; mirror: string | null }

/**
 * cover 归一：站内相对路径补 origin；绝对 URL 顺便问一次 R2 镜像（anitabi
 * 直连常被防盗链挡）；协议相对地址（//…）直接弃用。original 永远保留，
 * 镜像抓不到时还有一次回落机会（见 fetchCoverForRender）。
 */
async function resolveCoverParts(deps: PageCardDeps, cover: string | null): Promise<CoverParts | null> {
  const raw = String(cover || '').trim()
  if (!raw || raw.startsWith('//')) return null
  let original: string
  try {
    original = new URL(raw, deps.origin).toString()
  } catch {
    return null
  }
  const mirror = await deps.resolveAnimeImageUrl(original).catch(() => null)
  return { original, mirror }
}

/** 同源 `/assets/<id>` 封面：返回资产 id（直读存储，不走 HTTP）；其余返回 null */
function siteAssetId(deps: PageCardDeps, absoluteUrl: string): string | null {
  try {
    const parsed = new URL(absoluteUrl)
    if (parsed.origin !== new URL(deps.origin).origin) return null
    if (!parsed.pathname.startsWith('/assets/')) return null
    const id = parsed.pathname.slice('/assets/'.length).replace(/^\/+|\/+$/g, '')
    if (!id || id.includes('/') || id.includes('..')) return null
    return id
  } catch {
    return null
  }
}

async function readCoverBytes(deps: PageCardDeps, url: string): Promise<CoverImageResult> {
  try {
    const assetId = siteAssetId(deps, url)
    // 没注入直读函数时按临时失败处理：宁可走兜底，也不把无封面卡长期缓存
    if (assetId) return deps.readSiteAsset ? await deps.readSiteAsset(assetId) : { status: 'transient' }
    return await deps.fetchImage(url)
  } catch {
    return { status: 'transient' }
  }
}

/**
 * 渲染路径抓封面：先镜像（变体可能更近），失败再用原始绝对 URL 抓一次
 * （镜像对象可能尚未灌入 R2）。只有两次都是永久失败才算 missing（调用方渲染
 * 无封面卡）；任何一次是临时失败都返回 transient（调用方走 failed、不写缓存，
 * 否则网络抖一下就把无封面卡长期缓存下来）。
 */
async function fetchCoverForRender(deps: PageCardDeps, parts: CoverParts): Promise<CoverImageResult> {
  let sawTransient = false
  if (parts.mirror) {
    const viaMirror = await readCoverBytes(deps, parts.mirror)
    if (viaMirror.status === 'ok') return viaMirror
    sawTransient = viaMirror.status === 'transient'
  }
  const viaOriginal = await readCoverBytes(deps, parts.original)
  if (viaOriginal.status === 'ok') return viaOriginal
  return sawTransient || viaOriginal.status === 'transient' ? { status: 'transient' } : { status: 'missing' }
}

export type PageCardOutcome =
  | { status: 'rendered'; bytes: Uint8Array<ArrayBuffer> }
  | { status: 'cached'; bytes: Uint8Array<ArrayBuffer> }
  | { status: 'rate_limited' }
  | { status: 'budget_exhausted' }
  | { status: 'not_found' }
  /** reason='cover'：封面临时抓不到——兜底①再抓一次多半也是白等，直接跳过 */
  | { status: 'failed'; reason?: 'cover' }

/**
 * 渲染一张页面卡片并写进 R2。缓存命中不渲染、不计限流、不动预算；
 * 预算只防跑飞，成败都计数（Browser Run 时长消耗与成败无关）。
 * 任何一环失败返回 failed 且不写缓存，由调用方走兜底。封面永久失效（missing）
 * 例外：照常渲染无封面卡，ver 按无封面（coverUrl=''）计算写缓存——封面修好后
 * 带封面的 key 未命中会重抓，成功即换新图。
 * cacheOnly=true 时只读缓存（兜底链受限模式），未命中直接 failed。
 */
export async function renderAndStorePageCard(
  deps: PageCardDeps,
  input: {
    kind: PageCardKind
    id: string
    locale: SupportedLocale
    content: PageCardContent
    /** 缓存未命中、真正开渲前的放行闸（匿名限流）。缺省直接放行。 */
    authorizeRender?: () => boolean
    /** 只查缓存不渲染（总预算耗尽/限流后的兜底模式） */
    cacheOnly?: boolean
  },
): Promise<PageCardOutcome> {
  const store = deps.getStore()
  const parts = await resolveCoverParts(deps, input.content.cover)
  const coverUrl = parts ? parts.mirror || parts.original : null

  // 闸 1：缓存命中直接回（ver 已含标题/封面/文案指纹，内容变了自然换 key）
  const key = await pageCardCacheKey(
    input.kind,
    input.id,
    input.locale,
    input.content,
    coverUrl,
  )
  if (store) {
    const cached = await store.get(key).catch(() => null)
    if (cached) {
      try {
        return { status: 'cached', bytes: await readAllBytes(cached.body) }
      } catch (error) {
        // R2 对象在、流坏了：当缓存未命中继续走，别把读流异常抛成 500
        console.error('[og.page_card.cache_read_failed]', { key, error })
      }
    }
  }

  if (input.cacheOnly) return { status: 'failed' }

  // 闸 2：匿名限流（只有未命中才走到这）
  if (input.authorizeRender && !input.authorizeRender()) {
    return { status: 'rate_limited' }
  }

  // 闸 3：全局日预算：耗尽就不再起 Browser Run
  if (store && (await readPageCardBudget(store, deps.now())) >= PAGE_CARD_DAILY_BUDGET) {
    return { status: 'budget_exhausted' }
  }

  const coverResult = parts ? await fetchCoverForRender(deps, parts) : null
  if (coverResult?.status === 'transient') return { status: 'failed', reason: 'cover' }
  const cover = coverResult?.status === 'ok' ? coverResult : null
  let storeKey = key
  if (coverResult?.status === 'missing') {
    // 封面永久失效：无封面卡按无封面 ver 缓存；已有就直接回，不再耗 Browser Run
    storeKey = await pageCardCacheKey(input.kind, input.id, input.locale, input.content, null)
    const coverless = store ? await store.get(storeKey).catch(() => null) : null
    if (coverless) {
      try {
        return { status: 'cached', bytes: await readAllBytes(coverless.body) }
      } catch (error) {
        console.error('[og.page_card.cache_read_failed]', { key: storeKey, error })
      }
    }
  }

  const html = buildPageCardHtml({
    kind: input.kind,
    locale: input.locale,
    title: input.content.title,
    subtitle: input.content.subtitle,
    coverDataUri: cover ? toDataUri(cover.bytes, cover.contentType) : null,
  })

  let bytes: Uint8Array<ArrayBuffer> | null = null
  try {
    bytes = await deps.renderCard({
      html,
      width: PAGE_CARD_WIDTH,
      height: PAGE_CARD_HEIGHT,
    })
  } finally {
    // 成败都计数：上游持续报错时预算也要增长，否则每次未命中都真等 20 秒
    if (store) {
      await bumpPageCardBudget(store, deps.now()).catch((error: unknown) => {
        console.error('[og.page_card.budget_write_failed]', { error })
      })
    }
  }
  if (!bytes) return { status: 'failed' }

  if (store) {
    await store.put(storeKey, bytes, 'image/jpeg').catch((error: unknown) => {
      console.error('[og.page_card.cache_write_failed]', { key: storeKey, error })
    })
  }
  return { status: 'rendered', bytes }
}

/**
 * Promise.race 式的软 deadline：到点 resolve failed 走兜底，落败的渲染
 * 继续在后台跑（写缓存照常），迟到异常不再冒泡。Cloudflare 上落败的渲染
 * 必须登记进 ctx.waitUntil，否则响应返回后 isolate 可能被回收、缓存永远
 * 写不上；registerBackground 须在请求开始时就绑好 ctx（deps.bindWaitUntil），
 * 本地/测试拿不到 ctx 时忽略（参照 lib/asset/handlers.ts runBackground）。
 */
function withRenderDeadline(
  work: Promise<PageCardOutcome>,
  deadlineMs: number,
  target: string,
  registerBackground?: (promise: Promise<unknown>) => void,
): Promise<PageCardOutcome> {
  return new Promise<PageCardOutcome>((resolve, reject) => {
    const timer = setTimeout(() => {
      console.error('[og.page_card.render_deadline]', { target, deadlineMs })
      if (registerBackground) {
        registerBackground(work.then(
          () => undefined,
          () => undefined,
        ))
      }
      resolve({ status: 'failed' })
    }, deadlineMs)
    work.then(
      (outcome) => {
        clearTimeout(timer)
        resolve(outcome)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

function imageResponse(bytes: BodyInit, cacheControl: string = PAGE_CARD_CACHE_CONTROL): Response {
  return new Response(bytes, {
    status: 200,
    headers: {
      'content-type': 'image/jpeg',
      'cache-control': cacheControl,
      'x-content-type-options': 'nosniff',
    },
  })
}

function proxyImageResponse(bytes: BodyInit, contentType: string): Response {
  return new Response(bytes, {
    status: 200,
    headers: {
      'content-type': contentType,
      'cache-control': FALLBACK_CACHE,
      'x-content-type-options': 'nosniff',
    },
  })
}

/**
 * 兜底链第 ②③④ 级（①转发封面字节在 fallbackResponse 里）：
 * ② R2 静态兜底图 `og-pages/_fallback.jpg`（上线后调生产 /api/og/site/home/zh.jpg
 *    渲染出来再上传，仓库里没有 public/og/default.jpg，代码不能依赖它）；
 * ③ site/home、同一 locale 的页面卡片——缓存命中直接回；allowRender 且剩余
 *    预算足够时才渲染一次（主渲染已失败/限流/超时后只读缓存，防绕过与超时）；
 * ④ 都失败 503 + no-store。绝不返回 SVG、绝不 302（跨域/失效 302 会被平台缓存）。
 *
 * cacheControl（只管 ③）：只有请求本身就是 site/home/<locale>（以及
 * /opengraph-image）时才传 PAGE_CARD_CACHE_CONTROL；替别的 kind/id 顶上一律
 * FALLBACK_CACHE。r2CacheControl（只管 ②）缺省 FALLBACK_CACHE：_fallback.jpg
 * 是中文卡，不能长缓存到 en/ja 地址上；只有本来就是中文的 /opengraph-image 传长缓存。
 *
 * `/opengraph-image` 兼容路由（app/opengraph-image/route.ts）复用这条链（zh）。
 */
export async function r2ThenSiteCardResponse(
  deps: PageCardDeps,
  locale: SupportedLocale,
  opts: {
    cacheControl?: string
    r2CacheControl?: string
    allowRender?: boolean
    remainingMs?: number
    /** 已在请求开始时绑好的 waitUntil；缺省在这里（本函数入口）绑一次 */
    waitUntil?: ((promise: Promise<unknown>) => void) | null
  } = {},
): Promise<Response> {
  const waitUntil = opts.waitUntil !== undefined ? opts.waitUntil : deps.bindWaitUntil?.() ?? null
  const cacheControl = opts.cacheControl ?? FALLBACK_CACHE
  const store = deps.getStore()
  if (store) {
    const fallback = await store.get(R2_FALLBACK_KEY).catch(() => null)
    if (fallback) {
      try {
        const bytes = await readAllBytes(fallback.body)
        return new Response(bytes, {
          status: 200,
          headers: {
            'content-type': fallback.contentType || 'image/jpeg',
            'cache-control': opts.r2CacheControl ?? FALLBACK_CACHE,
            'x-content-type-options': 'nosniff',
          },
        })
      } catch (error) {
        // R2 读流异常按没有这张兜底图处理，继续往 ③ 走，不能抛成 500
        console.error('[og.page_card.fallback_read_failed]', { error })
      }
    }
  }
  // site/home 兜底卡：内容查找失败只记日志，继续往 ④ 走
  let site: PageCardContent | null = null
  try {
    site = await deps.loadContent('site', 'home', locale)
  } catch (error) {
    console.error('[og.page_card.fallback_content_threw]', { locale, error })
  }
  if (site && String(site.title || '').trim()) {
    const remaining = opts.remainingMs ?? Number.POSITIVE_INFINITY
    const canRender = opts.allowRender !== false && remaining > 0
    let outcome: PageCardOutcome | null = null
    try {
      if (canRender) {
        // ③ 的渲染 deadline 不超过单请求总预算的剩余部分
        const deadline = Math.max(
          1,
          Math.min(deps.renderDeadlineMs ?? PAGE_CARD_COLD_DEADLINE_MS, remaining),
        )
        outcome = await withRenderDeadline(
          renderAndStorePageCard(deps, { kind: 'site', id: 'home', locale, content: site }),
          deadline,
          `site/home/${locale}`,
          waitUntil ?? undefined,
        )
      } else {
        outcome = await renderAndStorePageCard(deps, {
          kind: 'site',
          id: 'home',
          locale,
          content: site,
          cacheOnly: true,
        })
      }
    } catch (error) {
      console.error('[og.page_card.fallback_render_threw]', { locale, error })
    }
    if (outcome && (outcome.status === 'rendered' || outcome.status === 'cached')) {
      return imageResponse(outcome.bytes, cacheControl)
    }
  }
  // 503 而不是 404：告诉平台「暂时拿不到」，no-store 防止把失败缓存下来
  return NextResponse.json(
    { error: '图片暂不可用' },
    { status: 503, headers: { 'cache-control': 'no-store' } },
  )
}

/**
 * 页面卡片的完整兜底链（全部同源，跨域 302 会被各平台缓存成 404）：
 * 1. 服务端抓封面字节直接转发（只认位图类型；站内 /assets 直读存储）；
 * 2. R2 静态兜底图 → 3. site/home 同 locale 卡片 → 4. 503 no-store（见上）。
 */
async function fallbackResponse(
  deps: PageCardDeps,
  content: PageCardContent | null,
  locale: SupportedLocale,
  opts: {
    allowRender?: boolean
    cacheControl?: string
    remainingMs?: number
    waitUntil?: ((promise: Promise<unknown>) => void) | null
    /** 主渲染正是因为封面抓不到才失败：①再抓一次多半白等，直接跳过 */
    skipCoverProxy?: boolean
  } = {},
): Promise<Response> {
  // ① 也受单请求总预算约束：剩余不足 COVER_PROXY_MIN_REMAINING_MS 直接跳过，
  // 否则用剩余时间做 race，超时就当没抓到（抓取本身留在后台自生自灭）
  const budgetMs = Math.min(opts.remainingMs ?? PAGE_CARD_TOTAL_BUDGET_MS, PAGE_CARD_TOTAL_BUDGET_MS)
  if (content?.cover && !opts.skipCoverProxy && budgetMs >= COVER_PROXY_MIN_REMAINING_MS) {
    const proxied = (async (): Promise<Response | null> => {
      const parts = await resolveCoverParts(deps, content.cover).catch(() => null)
      if (!parts) return null
      const image = await readCoverBytes(deps, parts.mirror || parts.original)
      if (image.status !== 'ok') return null
      const contentType = normalizeImageContentType(image.contentType)
      return PROXY_SAFE_IMAGE_PATTERN.test(contentType) ? proxyImageResponse(image.bytes, contentType) : null
    })().catch(() => null)
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), budgetMs)
    })
    const response = await Promise.race([proxied, timeout]).finally(() => clearTimeout(timer))
    if (response) return response
  }
  return r2ThenSiteCardResponse(deps, locale, {
    allowRender: opts.allowRender,
    cacheControl: opts.cacheControl,
    remainingMs: opts.remainingMs,
    waitUntil: opts.waitUntil ?? null,
  })
}

/** 剥掉可选的小写 `.jpg` 后缀（`.JPG` 不认，交由上层校验拒绝） */
function stripJpgSuffix(segment: string): string {
  return segment.endsWith('.jpg') ? segment.slice(0, -4) : segment
}

/**
 * id 会进 R2 key 与内容查找，字符集与现有 slug/animeId/cityId 一致（CJK slug
 * 允许）；显式挡掉 `..`、路径分隔符与控制字符，防路径穿越。
 */
function isValidPageCardId(id: string): boolean {
  if (!id || id.length > 200) return false
  if (id.includes('..') || id.includes('/') || id.includes('\\')) return false
  // eslint-disable-next-line no-control-regex
  return !/[\u0000-\u001f\u007f]/.test(id)
}

export function createGetPageCardHandler(deps: PageCardDeps) {
  return async function getPageCard(
    req: Request,
    ctx: { params: Promise<{ segments?: string[] }> },
  ): Promise<Response> {
    const startedAtMs = Date.now()
    const totalBudgetMs = deps.totalBudgetMs ?? PAGE_CARD_TOTAL_BUDGET_MS
    const remainingMs = () => totalBudgetMs - (Date.now() - startedAtMs)
    // 请求开始时就把 ctx.waitUntil 绑好：deadline 的 setTimeout 回调里再现取不可靠
    const waitUntil = deps.bindWaitUntil?.() ?? null

    const raw = await ctx.params
    const segments = raw.segments ?? []

    // /api/og/<kind>/<id>/<locale>[.jpg]，对非法段严格 400
    if (segments.length !== 3) {
      return NextResponse.json({ error: '参数不合法' }, { status: 400 })
    }
    let kindSeg: string, idSeg: string, localeSeg: string
    try {
      ;[kindSeg, idSeg, localeSeg] = segments.map((segment) => decodeURIComponent(segment))
    } catch {
      // 畸形百分号序列（如裸 %）会抛 URIError，参数问题回 400 而不是 500
      return NextResponse.json({ error: '参数不合法' }, { status: 400 })
    }
    const kind = kindSeg.trim()
    if (!PATH_KINDS.includes(kind as PageCardKind)) {
      return NextResponse.json({ error: '参数不合法' }, { status: 400 })
    }
    const cardKind = kind as PageCardKind
    const id = idSeg.trim()
    if (!isValidPageCardId(id) || (cardKind === 'site' && id !== 'home')) {
      return NextResponse.json({ error: '参数不合法' }, { status: 400 })
    }
    const localeName = stripJpgSuffix(localeSeg.trim())
    if (!PATH_LOCALES.includes(localeName)) {
      return NextResponse.json({ error: '参数不合法' }, { status: 400 })
    }
    const locale = localeName as SupportedLocale

    // 内容查找抛错按 not_found 处理：OG 路径永不 500（页面已缓存过的分享不能翻车）
    let content: PageCardContent | null = null
    try {
      content = await deps.loadContent(cardKind, id, locale)
    } catch (error) {
      console.error('[og.page_card.content_threw]', { kind: cardKind, id, locale, error })
    }
    if (!content || !String(content.title || '').trim()) {
      // 找不到内容不渲染也不 404：走兜底链（site/home 同 locale）。
      // 请求本身就是 site/home 时不再渲染一次自己，只读缓存。
      return fallbackResponse(deps, null, locale, {
        allowRender: cardKind !== 'site' && remainingMs() > 0,
        cacheControl: cardKind === 'site' ? PAGE_CARD_CACHE_CONTROL : FALLBACK_CACHE,
        remainingMs: remainingMs(),
        waitUntil,
      })
    }

    const now = deps.now()
    const ip = readClientIp(req)
    const ipHash = ip ? await hashIp(ip, now) : null

    let outcome: PageCardOutcome
    try {
      // 主渲染 deadline 不超过单请求总预算（默认 8s < 9s，通常不受影响）
      const mainDeadline = Math.max(
        1,
        Math.min(deps.renderDeadlineMs ?? PAGE_CARD_COLD_DEADLINE_MS, totalBudgetMs),
      )
      outcome = await withRenderDeadline(
        renderAndStorePageCard(deps, {
          kind: cardKind,
          id,
          locale,
          content,
          authorizeRender: ipHash ? () => checkPageCardRate(ipHash, now) : undefined,
        }),
        mainDeadline,
        `${cardKind}/${id}/${locale}`,
        waitUntil ?? undefined,
      )
    } catch (error) {
      // 内容加载后的任何异常都不能抛穿成 500：各平台会把「无预览」缓存下来
      console.error('[og.page_card.render_threw]', { kind: cardKind, id, locale, error })
      outcome = { status: 'failed' }
    }

    if (outcome.status === 'rendered' || outcome.status === 'cached') {
      return imageResponse(outcome.bytes)
    }
    // 走到这里只可能是 failed / rate_limited / budget_exhausted：③ 一律只读缓存。
    // failed 后再渲染会超总预算；限流后渲染等于绕过限流（所以也不回 429——平台
    // 会把「无预览」缓存下来）；预算耗尽再渲染也只会再撞一次预算。
    // site/home 的缓存靠部署后预热（上线后调一次各 locale 的 /api/og/site/home）。
    const isSelfSiteHome = cardKind === 'site' && id === 'home'
    return fallbackResponse(deps, content, locale, {
      allowRender: false,
      waitUntil,
      skipCoverProxy: outcome.status === 'failed' && outcome.reason === 'cover',
      cacheControl: isSelfSiteHome ? PAGE_CARD_CACHE_CONTROL : FALLBACK_CACHE,
      remainingMs: remainingMs(),
    })
  }
}
