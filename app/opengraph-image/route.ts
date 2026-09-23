import { NextResponse } from 'next/server'
import { getPageCardDeps } from '@/lib/og/pageCardApi'
import { PAGE_CARD_CACHE_CONTROL, r2ThenSiteCardResponse } from '@/lib/og/handlers/pageCard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * 兼容路径：外部平台与 lib/share/handlers/card.ts 的最后一级兜底都缓存过
 * `/opengraph-image`。删掉 SVG 文件约定（app/opengraph-image.tsx）后，这里
 * 复用页面卡片的兜底链：先读 R2 `og-pages/_fallback.jpg`，没有就走
 * site/home/zh 的缓存或渲染，再失败 503 + no-store。
 * 这是请求「本身」的图（不是替别人顶包），所以缓存头用 PAGE_CARD_CACHE_CONTROL；
 * _fallback.jpg 本来就是中文卡，与这个地址语言一致，② 也可以长缓存。
 * 不返回 SVG、不 302（仓库里不放静态兜底图，上线后由站长上传 R2）。
 */
export async function GET() {
  try {
    const deps = await getPageCardDeps()
    return await r2ThenSiteCardResponse(deps, 'zh', {
      cacheControl: PAGE_CARD_CACHE_CONTROL,
      r2CacheControl: PAGE_CARD_CACHE_CONTROL,
    })
  } catch (err) {
    console.error('[opengraph-image] failed', err)
    return NextResponse.json(
      { error: '图片暂不可用' },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    )
  }
}
