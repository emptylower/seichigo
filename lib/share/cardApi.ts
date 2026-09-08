import { MAX_INLINE_IMAGE_BYTES, type CardDeps } from '@/lib/share/handlers/card'

let cached: CardDeps | null = null

/** 抓上游图的超时：卡片本身有 20 秒预算，图不能占太多 */
const IMAGE_FETCH_TIMEOUT_MS = 6_000

/**
 * 卡片自带一套 deps（同 lib/share/pointContextApi.ts 的理由）：ShareApiDeps 被
 * v1 的四条路由与它们的单测共用，往里加必填字段会连带改动 v1 测试。
 */
export async function getCardDeps(): Promise<CardDeps> {
  if (cached) return cached

  const [
    { PrismaPointContextRepo },
    { fetchMapTilerAddresses },
    { getShareStore },
    { readBrowserRunConfig, renderHtmlToJpeg },
    { resolveMirrorPublicUrl },
    { getSiteOrigin },
  ] = await Promise.all([
    import('@/lib/share/pointContextRepoPrisma'),
    import('@/lib/share/geocode'),
    import('@/lib/share/store'),
    import('@/lib/share/browserRun'),
    import('@/lib/anitabi/imageProxy'),
    import('@/lib/seo/site'),
  ])

  cached = {
    repo: new PrismaPointContextRepo(),
    geocode: (input) => fetchMapTilerAddresses(input),
    getStore: getShareStore,
    now: () => new Date(),
    origin: getSiteOrigin(),
    resolveAnimeImageUrl: (rawUrl) => resolveMirrorPublicUrl(rawUrl, { kind: 'point' }),
    async renderCard(input) {
      const config = readBrowserRunConfig()
      if (!config) {
        console.error('[share.card.no_browser_run_config]', {
          event: 'share_card_no_browser_run_config',
        })
        return null
      }
      return renderHtmlToJpeg({ ...input, config })
    },
    async fetchImage(url) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(IMAGE_FETCH_TIMEOUT_MS) })
        if (!res.ok) return null
        const bytes = new Uint8Array(await res.arrayBuffer())
        if (!bytes.byteLength || bytes.byteLength > MAX_INLINE_IMAGE_BYTES) return null
        return {
          bytes,
          contentType: String(res.headers.get('content-type') || 'image/jpeg'),
        }
      } catch {
        return null
      }
    },
  }

  return cached
}
