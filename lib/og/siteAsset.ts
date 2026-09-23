import { MAX_INLINE_IMAGE_BYTES } from '@/lib/share/handlers/card'
import { loadOriginalBytes, loadVariantBytes } from '@/lib/asset/handlers'
import { getAssetStore, type AssetStore } from '@/lib/asset/store'
import type { AssetRepo } from '@/lib/asset/repo'
import {
  normalizeImageContentType,
  PROXY_SAFE_IMAGE_PATTERN,
  type CoverImageResult,
} from '@/lib/og/coverImage'

/**
 * 页面卡片封面用的变体规格：卡片封面区 520px 宽，1200 留足 2x 余量；原图常是
 * 1600 宽 webp 或上传的大 PNG，直接内联既可能超 MAX_INLINE_IMAGE_BYTES 又拖慢渲染。
 */
export const OG_COVER_VARIANT = { width: 1200, quality: 80 } as const

type SiteAssetReaderDeps = {
  getRepo: () => AssetRepo | Promise<AssetRepo>
  getStore: () => AssetStore | null
}

/**
 * 站内封面 `/assets/<id>` 的直读入口：Worker 自己 fetch 自己的域名既慢又占
 * 子请求数。这里复用 /assets/[id] 路由的同一套读取函数（lib/asset/handlers.ts）：
 * 1. 优先 `?w=` 同款缩放变体（R2 变体命中直接读，未命中现转并回写）；
 * 2. 拿不到变体才读原图——先看元数据 byteLength，超过内联上限就不读字节，
 *    直接算永久失败（渲染无封面卡），免得把几 MB 原图拽进内存再丢掉。
 * 返回 ok / missing（永久）/ transient（临时），语义见 lib/og/coverImage.ts。
 */
export function createSiteAssetReader(deps: SiteAssetReaderDeps) {
  return async function readSiteAsset(assetId: string): Promise<CoverImageResult> {
    let repo: AssetRepo
    let asset: Awaited<ReturnType<AssetRepo['findById']>>
    try {
      repo = await deps.getRepo()
      asset = await repo.findById(assetId)
    } catch (error) {
      // 数据库抖动是临时失败：不能把无封面卡长期缓存下来
      console.error('[og.site_asset.lookup_failed]', { assetId, error })
      return { status: 'transient' }
    }
    if (!asset) return { status: 'missing' }
    const contentType = normalizeImageContentType(asset.contentType)
    // heic/avif/svg 等 Browser Run 与爬虫未必解得开：与兜底①同一白名单，算永久失败
    if (!PROXY_SAFE_IMAGE_PATTERN.test(contentType)) return { status: 'missing' }

    const store = deps.getStore()
    try {
      const variant = await loadVariantBytes(asset, store, repo, OG_COVER_VARIANT)
      if (variant && variant.byteLength && variant.byteLength <= MAX_INLINE_IMAGE_BYTES) {
        return { status: 'ok', bytes: variant as Uint8Array<ArrayBuffer>, contentType: 'image/webp' }
      }
    } catch (error) {
      // 变体转换失败（Images 绑定报错等）不致命：照 /assets 路由的做法回落原图
      console.error('[og.site_asset.variant_failed]', { assetId, error })
    }

    if (asset.byteLength != null && asset.byteLength > MAX_INLINE_IMAGE_BYTES) {
      return { status: 'missing' }
    }
    let bytes: Uint8Array | null
    try {
      bytes = await loadOriginalBytes(asset, store, repo)
    } catch (error) {
      console.error('[og.site_asset.read_failed]', { assetId, error })
      return { status: 'transient' }
    }
    // 元数据在、字节没了（R2 与 bytes 列都读不到）按永久处理：下次请求照样会重试
    if (!bytes || !bytes.byteLength || bytes.byteLength > MAX_INLINE_IMAGE_BYTES) {
      return { status: 'missing' }
    }
    return { status: 'ok', bytes: bytes as Uint8Array<ArrayBuffer>, contentType }
  }
}

/** 生产入口（pageCardApi 注入）：Prisma 仓库懒加载，单测用 createSiteAssetReader 换内存实现 */
export const readSiteAssetBytes = createSiteAssetReader({
  getRepo: async () => new (await import('@/lib/asset/repoPrisma')).PrismaAssetRepo(),
  getStore: getAssetStore,
})
