import type { SupportedLocale } from '@/lib/i18n/types'
import { t } from '@/lib/i18n'
import { NextResponse } from 'next/server'
import { buildCardHtml, formatSceneTime } from '@/lib/share/cardHtml'
import { DAILY_RENDER_BUDGET, bumpRenderBudget, checkCardRate, readRenderBudget } from '@/lib/share/cardBudget'
import type { PointContextDeps } from '@/lib/share/handlers/pointContext'
import { loadPointContext } from '@/lib/share/handlers/pointContext'
import { hashIp, readClientIp } from '@/lib/share/ipHash'
import type { ShareStore } from '@/lib/share/store'
import { SHARE_CARD_SIZES, isShareCardLayout, type ShareCardLayout } from '@/lib/share/types'
import { buildCardQrTarget } from '@/lib/share/view'

export type CardDeps = PointContextDeps & {
  /** 每次请求现取：R2 绑定挂在 per-request 的 cloudflare context 上 */
  getStore: () => ShareStore | null
  renderCard: (input: {
    html: string
    width: number
    height: number
  }) => Promise<Uint8Array<ArrayBuffer> | null>
  /** 动画截图原始 URL → R2 镜像公共域 URL（resolveMirrorPublicUrl） */
  resolveAnimeImageUrl: (rawUrl: string) => Promise<string | null>
  fetchImage: (url: string) => Promise<{ bytes: Uint8Array<ArrayBuffer>; contentType: string } | null>
  /** 站点权威 origin，用来拼二维码深链 */
  origin: string
}

const LOCALES: readonly string[] = ['zh', 'en', 'ja']

export function normalizeCardLocale(value: string | null): SupportedLocale {
  const raw = String(value || '').trim()
  return LOCALES.includes(raw) ? (raw as SupportedLocale) : 'zh'
}

export function normalizeCardLayout(value: string | null): ShareCardLayout {
  const raw = String(value || '').trim()
  return isShareCardLayout(raw) ? raw : 'landscape'
}

/**
 * 只接受实拍 key 的形状（`checkin/<userId>/<pointId>.jpg`，见 lib/share/store.ts:34）。
 * 显式挡掉 `..`，防止把读取引到桶里其他对象。
 */
export function isCheckinPhotoKey(value: string): boolean {
  const key = String(value || '')
  if (!key || key.includes('..')) return false
  return /^checkin\/[A-Za-z0-9_-]{1,64}\/[A-Za-z0-9_:.-]{1,200}\.jpg$/.test(key)
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  let hex = ''
  for (const byte of new Uint8Array(digest)) hex += byte.toString(16).padStart(2, '0')
  return hex
}

/** `og-cards/<pointId>__<locale>__<layout>[__<photoKey sha256 前 12>].webp` */
export async function cardCacheKey(
  pointId: string,
  locale: SupportedLocale,
  layout: ShareCardLayout,
  photoKey: string | null,
): Promise<string> {
  const base = `og-cards/${pointId}__${locale}__${layout}`
  if (!photoKey) return `${base}.webp`
  return `${base}__${(await sha256Hex(photoKey)).slice(0, 12)}.webp`
}

/** Worker 里没有 Buffer 保证，按 8KB 分块走 btoa */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x2000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

function toDataUri(bytes: Uint8Array, contentType: string): string {
  const type = String(contentType || '').trim() || 'image/jpeg'
  return `data:${type};base64,${bytesToBase64(bytes)}`
}

async function readAllBytes(stream: ReadableStream<Uint8Array>): Promise<Uint8Array<ArrayBuffer>> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) {
      chunks.push(value)
      total += value.byteLength
    }
  }
  const merged = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return merged
}

/**
 * renderAndStoreCard 的判别式结果：handler 按 status 决定响应，
 * 预热（lib/share/api.ts）与 HTTP 请求共用这条渲染路径。
 */
export type RenderOutcome =
  | { status: 'rendered'; bytes: Uint8Array<ArrayBuffer>; contentType: string }
  | { status: 'cached'; bytes: Uint8Array<ArrayBuffer>; contentType: string }
  | { status: 'rate_limited' }
  | { status: 'budget_exhausted' }
  | { status: 'not_found' }
  | { status: 'failed' }

/**
 * 渲染一张卡片并写进 R2。缓存检查、匿名限流、全局日预算三道闸门都在这里面，
 * 请求与预热共用：命中缓存不渲染、不计限流；预算耗尽不再起 Browser Run。
 * 任何一环失败返回 `{ status: 'failed' }` 且不写缓存，由调用方走兜底。
 */
export async function renderAndStoreCard(
  deps: CardDeps,
  input: {
    pointId: string
    locale: SupportedLocale
    layout: ShareCardLayout
    photoKey: string | null
    /** 缓存未命中、真正开渲前的放行闸（匿名限流）。预热不传，直接放行。 */
    authorizeRender?: () => boolean
  },
): Promise<RenderOutcome> {
  const store = deps.getStore()

  // 闸 1：缓存命中直接回，不计限流、不动预算
  const key = await cardCacheKey(input.pointId, input.locale, input.layout, input.photoKey)
  if (store) {
    const cached = await store.get(key).catch(() => null)
    if (cached) {
      return {
        status: 'cached',
        bytes: await readAllBytes(cached.body),
        contentType: cached.contentType || 'image/webp',
      }
    }
  }

  // 闸 2：匿名限流（只有未命中才走到这）
  if (input.authorizeRender && !input.authorizeRender()) {
    return { status: 'rate_limited' }
  }

  const context = await loadPointContext(deps, input.pointId, input.locale)
  if (!context) return { status: 'not_found' }

  // 闸 3：全局日预算：耗尽就不再渲染
  if (store && (await readRenderBudget(store, deps.now())) >= DAILY_RENDER_BUDGET) {
    return { status: 'budget_exhausted' }
  }

  const animeUrl = context.image ? await deps.resolveAnimeImageUrl(context.image) : null
  const animeImage = animeUrl ? await deps.fetchImage(animeUrl) : null
  const photoObject =
    input.photoKey && store ? await store.get(input.photoKey).catch(() => null) : null
  const photoBytes = photoObject ? await readAllBytes(photoObject.body) : null

  const size = SHARE_CARD_SIZES[input.layout]
  const html = buildCardHtml({
    layout: input.layout,
    locale: input.locale,
    displayName: context.displayName,
    animeTitle: context.animeTitle,
    episode: context.episode,
    scene: context.scene ? formatSceneTime(context.scene) : null,
    address: context.address,
    note: context.note,
    geo: context.geo,
    inJapan: context.inJapan,
    animeImageDataUri: animeImage ? toDataUri(animeImage.bytes, animeImage.contentType) : null,
    photoDataUri: photoBytes ? toDataUri(photoBytes, photoObject!.contentType) : null,
    qrTargetUrl: buildCardQrTarget({
      origin: deps.origin,
      locale: input.locale,
      bangumiId: context.bangumiId,
      pointId: input.pointId,
    }),
    text: {
      qrTitle: t('share.cardQrTitle', input.locale),
      qrSub: t('share.cardQrSub', input.locale),
      tagline: t('share.cardTagline', input.locale),
    },
  })

  let bytes: Uint8Array<ArrayBuffer> | null = null
  try {
    bytes = await deps.renderCard({ html, width: size.width, height: size.height })
  } finally {
    // Browser Run 失败与超时同样消耗浏览器时长：成败都计数，
    // 否则上游持续报错时预算永不增长、每次未命中都真等 20 秒
    if (store) {
      await bumpRenderBudget(store, deps.now()).catch((error: unknown) => {
        console.error('[share.card.budget_write_failed]', { error })
      })
    }
  }
  if (!bytes) return { status: 'failed' }

  if (store) {
    await store.put(key, bytes, 'image/webp').catch((error: unknown) => {
      console.error('[share.card.cache_write_failed]', { key, error })
    })
  }
  return { status: 'rendered', bytes, contentType: 'image/webp' }
}

// pointId 会进 R2 key 与 URL，字符集与 lib/share/handlers/links.ts:23 保持一致
const POINT_ID_PATTERN = /^[A-Za-z0-9_:.-]{1,200}$/

const IMMUTABLE = 'public, max-age=31536000, immutable'
/** 失败兜底不写缓存，公共缓存只敢放 60 秒 */
const FALLBACK_CACHE = 'public, max-age=60'

function imageResponse(body: BodyInit, contentType = 'image/webp'): Response {
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': contentType,
      'cache-control': IMMUTABLE,
      'x-content-type-options': 'nosniff',
    },
  })
}

function redirect(location: string): Response {
  return new Response(null, {
    status: 302,
    headers: { location, 'cache-control': FALLBACK_CACHE },
  })
}

/** 静态兜底图 key：由站长侧预先上传到 ASSET_STORE，代码只读不写 */
function staticFallbackKey(layout: ShareCardLayout): string {
  return `og-cards/_fallback-${layout}.webp`
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
 * 兜底全部同源（跨域 302 会被前端 fetch 直接抛错，各平台还可能缓存到 404）：
 * 1. 服务端抓该点位动画截图镜像 URL 的字节直接转发（fetchImage 自带超时与大小上限）；
 * 2. 抓不到 → 读 R2 静态兜底图 `og-cards/_fallback-<layout>.webp`；
 * 3. 再没有 → 302 到站点默认 OG。
 */
async function fallbackResponse(
  deps: CardDeps,
  pointId: string,
  locale: SupportedLocale,
  layout: ShareCardLayout,
): Promise<Response> {
  const context = await loadPointContext(deps, pointId, locale).catch(() => null)
  if (context?.image) {
    const mirror = await deps.resolveAnimeImageUrl(context.image).catch(() => null)
    if (mirror) {
      const image = await deps.fetchImage(mirror).catch(() => null)
      if (image) return proxyImageResponse(image.bytes, image.contentType || 'image/jpeg')
    }
  }
  const store = deps.getStore()
  if (store) {
    const fallback = await store.get(staticFallbackKey(layout)).catch(() => null)
    if (fallback) {
      return proxyImageResponse(
        await readAllBytes(fallback.body),
        fallback.contentType || 'image/webp',
      )
    }
  }
  return redirect(`${deps.origin}/opengraph-image`)
}

export function createGetCardHandler(deps: CardDeps) {
  return async function getCard(
    req: Request,
    ctx: { params: Promise<{ pointId: string }> },
  ): Promise<Response> {
    const raw = await ctx.params
    const pointId = decodeURIComponent(String(raw.pointId || '')).trim()
    if (!POINT_ID_PATTERN.test(pointId) || pointId.includes('..')) {
      return NextResponse.json({ error: '参数不合法' }, { status: 400 })
    }

    const url = new URL(req.url)
    const locale = normalizeCardLocale(url.searchParams.get('locale'))
    const layout = normalizeCardLayout(url.searchParams.get('layout'))

    const store = deps.getStore()

    // photo 只接受实拍 key 的形状，且必须真的存在于 ASSET_STORE；不合格一律当没传
    const photoParam = String(url.searchParams.get('photo') || '').trim()
    let photoKey: string | null = null
    if (photoParam && isCheckinPhotoKey(photoParam) && store) {
      const exists = await store.get(photoParam).catch(() => null)
      if (exists) photoKey = photoParam
    }

    // 匿名限流闸挂在渲染路径里（缓存命中不计），见 renderAndStoreCard
    const now = deps.now()
    const ip = readClientIp(req)
    const ipHash = ip ? await hashIp(ip, now) : null

    let outcome: RenderOutcome
    try {
      outcome = await renderAndStoreCard(deps, {
        pointId,
        locale,
        layout,
        photoKey,
        authorizeRender: ipHash ? () => checkCardRate(ipHash, now) : undefined,
      })
    } catch (error) {
      // loadPointContext 的 Prisma 报错、base64 的 OOM 等都不能抛穿成 500 JSON，
      // 各平台会把「无预览」缓存下来
      console.error('[share.card.render_threw]', { pointId, error })
      outcome = { status: 'failed' }
    }

    if (outcome.status === 'rendered' || outcome.status === 'cached') {
      return imageResponse(outcome.bytes, outcome.contentType)
    }
    if (outcome.status === 'rate_limited') {
      return NextResponse.json({ error: '今日请求次数已达上限，请明天再试' }, { status: 429 })
    }
    if (outcome.status === 'not_found') {
      return NextResponse.json({ error: '点位不存在' }, { status: 404 })
    }
    return fallbackResponse(deps, pointId, locale, layout)
  }
}
