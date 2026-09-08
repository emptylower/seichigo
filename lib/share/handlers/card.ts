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

async function readAllBytes(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
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
 * 渲染一张卡片并写进 R2。返回字节；任何一环失败都返回 null 且不写缓存，
 * 由调用方走兜底（302 到动画截图 / /opengraph-image）。
 * 预热与请求路径共用这一个函数。
 */
export async function renderAndStoreCard(
  deps: CardDeps,
  input: {
    pointId: string
    locale: SupportedLocale
    layout: ShareCardLayout
    photoKey: string | null
  },
): Promise<Uint8Array<ArrayBuffer> | null> {
  const context = await loadPointContext(deps, input.pointId, input.locale)
  if (!context) return null

  const store = deps.getStore()

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

  const bytes = await deps.renderCard({ html, width: size.width, height: size.height })
  if (!bytes) return null

  if (store) {
    const key = await cardCacheKey(input.pointId, input.locale, input.layout, input.photoKey)
    await store.put(key, bytes, 'image/webp').catch((error: unknown) => {
      console.error('[share.card.cache_write_failed]', { key, error })
    })
  }
  return bytes
}

// pointId 会进 R2 key 与 URL，字符集与 lib/share/handlers/links.ts:23 保持一致
const POINT_ID_PATTERN = /^[A-Za-z0-9_:.-]{1,200}$/

const IMMUTABLE = 'public, max-age=31536000, immutable'
/** 失败兜底不写缓存，公共缓存只敢放 60 秒 */
const FALLBACK_CACHE = 'public, max-age=60'

function imageResponse(body: BodyInit): Response {
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'image/webp',
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

/**
 * 兜底：Browser Run 报错/超时/预算耗尽 → 302 到该点位的动画截图 R2 公共域 URL；
 * 都没有 → 302 到站点默认 OG。
 */
async function fallbackResponse(deps: CardDeps, image: string | null): Promise<Response> {
  const mirror = image ? await deps.resolveAnimeImageUrl(image) : null
  return redirect(mirror || `${deps.origin}/opengraph-image`)
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

    // 1) 缓存命中：直接回，且不计限流、不动预算
    if (store) {
      const key = await cardCacheKey(pointId, locale, layout, photoKey)
      const cached = await store.get(key).catch(() => null)
      if (cached) return imageResponse(cached.body)
    }

    const now = deps.now()

    // 2) 匿名限流（只有未命中才走到这）
    const ip = readClientIp(req)
    if (ip) {
      const ipHash = await hashIp(ip, now)
      if (!checkCardRate(ipHash, now)) {
        return NextResponse.json({ error: '今日请求次数已达上限，请明天再试' }, { status: 429 })
      }
    }

    // 3) 全局日预算：耗尽就不再渲染，直接兜底
    if (store && (await readRenderBudget(store, now)) >= DAILY_RENDER_BUDGET) {
      const context = await loadPointContext(deps, pointId, locale)
      if (!context) return NextResponse.json({ error: '点位不存在' }, { status: 404 })
      return fallbackResponse(deps, context.image)
    }

    const context = await loadPointContext(deps, pointId, locale)
    if (!context) return NextResponse.json({ error: '点位不存在' }, { status: 404 })

    const bytes = await renderAndStoreCard(deps, { pointId, locale, layout, photoKey })
    if (!bytes) return fallbackResponse(deps, context.image)

    if (store) {
      await bumpRenderBudget(store, now).catch((error: unknown) => {
        console.error('[share.card.budget_write_failed]', { error })
      })
    }
    return imageResponse(bytes)
  }
}
