import { NextResponse } from 'next/server'
import { getPageCardDeps } from '@/lib/og/pageCardApi'
import { createGetPageCardHandler } from '@/lib/og/handlers/pageCard'

export const runtime = 'nodejs'
// 限流要读 cf-connecting-ip，缓存与预算都要现取 R2 绑定，不能被静态化
export const dynamic = 'force-dynamic'

// 页面 OG 卡片（.jpg 结尾，供按扩展名识别图片的抓取器）：
// /api/og/<kind>/<id>/<locale>[.jpg]，kind ∈ post|anime|city|site
export async function GET(req: Request, ctx: { params: Promise<{ segments: string[] }> }) {
  try {
    const deps = await getPageCardDeps()
    return await createGetPageCardHandler(deps)(req, ctx)
  } catch (err) {
    console.error('[api/og] GET failed', err)
    return NextResponse.json({ error: '服务器错误' }, { status: 500 })
  }
}
