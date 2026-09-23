import { MAX_INLINE_IMAGE_BYTES } from '@/lib/share/handlers/card'
import type { PageCardDeps } from '@/lib/og/handlers/pageCard'
import { normalizeImageContentType, PROXY_SAFE_IMAGE_PATTERN } from '@/lib/og/coverImage'

let cached: PageCardDeps | null = null

/** 抓上游图的超时：卡片本身有 20 秒预算，图不能占太多（与 cardApi 同口径） */
const IMAGE_FETCH_TIMEOUT_MS = 6_000

/** deps 懒加载 + 缓存，照 lib/share/cardApi.ts：避免顶层 import 拖累冷启动 */
export async function getPageCardDeps(): Promise<PageCardDeps> {
  if (cached) return cached

  const [
    { getShareStore },
    { readBrowserRunConfig, renderHtmlToJpeg },
    { resolveMirrorPublicUrl },
    { getSiteOrigin },
    { loadPageCardContent },
    { readSiteAssetBytes },
    { getCfBindings },
  ] = await Promise.all([
    import('@/lib/share/store'),
    import('@/lib/share/browserRun'),
    import('@/lib/anitabi/imageProxy'),
    import('@/lib/seo/site'),
    import('@/lib/og/pageCardContent'),
    import('@/lib/og/siteAsset'),
    import('@/lib/anitabi/cf/bindings'),
  ])

  cached = {
    getStore: getShareStore,
    now: () => new Date(),
    origin: getSiteOrigin(),
    loadContent: loadPageCardContent,
    // 不传 kind：cover kind 会把 anitabi 封面镜像成 plan=h160（160px 高），
    // 页面卡片 520px 宽的主视觉糊成马赛克；镜像变体里没有更大的封面规格，
    // 干脆不带 kind——anitabi 封面回落原始 URL，bgm 封面仍能命中 /m/ 变体。
    resolveAnimeImageUrl: (rawUrl) => resolveMirrorPublicUrl(rawUrl),
    // 站内 /assets/<id> 封面直读资产存储，Worker 不 fetch 自己的域名
    readSiteAsset: readSiteAssetBytes,
    // 落败的渲染登记进 waitUntil，Cloudflare 上响应返回后 isolate 不被回收。
    // 请求开始时就取一次 ctx 并绑好（setTimeout 回调里现取可能已脱离请求上下文）；
    // 必须以 ctx 为 this 调用（同 lib/asset/handlers.ts runBackground 的坑）
    bindWaitUntil: () => {
      const ctx = getCfBindings()?.ctx
      if (!ctx || typeof ctx.waitUntil !== 'function') return null
      // 上面已判过 waitUntil 是函数；闭包里 TS 丢了收窄
      return (promise) => ctx.waitUntil!(promise.catch(() => undefined))
    },
    async renderCard(input) {
      const config = readBrowserRunConfig()
      if (!config) {
        console.error('[og.page_card.no_browser_run_config]', {
          event: 'og_page_card_no_browser_run_config',
        })
        return null
      }
      return renderHtmlToJpeg({ ...input, config })
    },
    async fetchImage(url) {
      let res: Response
      try {
        res = await fetch(url, { signal: AbortSignal.timeout(IMAGE_FETCH_TIMEOUT_MS) })
      } catch {
        // 超时/网络异常：临时失败，不能把无封面卡缓存下来
        return { status: 'transient' }
      }
      // 不读正文就返回的分支都要释放连接，否则占着 Worker 的并发子请求
      const discard = () => void res.body?.cancel().catch(() => undefined)
      if (!res.ok) {
        discard()
        // 5xx、408、429 是上游暂时不行；其余 4xx（404/410/403 防盗链）算永久失败
        const transient = res.status >= 500 || res.status === 408 || res.status === 429
        return { status: transient ? 'transient' : 'missing' }
      }
      const contentType = normalizeImageContentType(res.headers.get('content-type')) || 'image/jpeg'
      if (!PROXY_SAFE_IMAGE_PATTERN.test(contentType)) {
        discard()
        return { status: 'missing' }
      }
      // 先看 content-length，超上限不读正文
      const declared = Number(res.headers.get('content-length'))
      if (Number.isFinite(declared) && declared > MAX_INLINE_IMAGE_BYTES) {
        discard()
        return { status: 'missing' }
      }
      let bytes: Uint8Array<ArrayBuffer>
      try {
        bytes = new Uint8Array(await res.arrayBuffer())
      } catch {
        return { status: 'transient' }
      }
      if (!bytes.byteLength || bytes.byteLength > MAX_INLINE_IMAGE_BYTES) return { status: 'missing' }
      return { status: 'ok', bytes, contentType }
    },
  }

  return cached
}
