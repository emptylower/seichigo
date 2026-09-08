import type { SupportedLocale } from '@/lib/i18n/types'
import { t } from '@/lib/i18n'
import { buildCardHtml, formatSceneTime } from '@/lib/share/cardHtml'
import type { PointContextDeps } from '@/lib/share/handlers/pointContext'
import { loadPointContext } from '@/lib/share/handlers/pointContext'
import type { ShareStore } from '@/lib/share/store'
import { SHARE_CARD_SIZES, isShareCardLayout, type ShareCardLayout } from '@/lib/share/types'
import { buildCardQrTarget } from '@/lib/share/view'

export type CardDeps = PointContextDeps & {
  /** 每次请求现取：R2 绑定挂在 per-request 的 cloudflare context 上 */
  getStore: () => ShareStore | null
  renderCard: (input: { html: string; width: number; height: number }) => Promise<Uint8Array | null>
  /** 动画截图原始 URL → R2 镜像公共域 URL（resolveMirrorPublicUrl） */
  resolveAnimeImageUrl: (rawUrl: string) => Promise<string | null>
  fetchImage: (url: string) => Promise<{ bytes: Uint8Array; contentType: string } | null>
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
): Promise<Uint8Array | null> {
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
