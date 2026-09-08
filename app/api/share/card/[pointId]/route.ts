import { NextResponse } from 'next/server'
import { getCardDeps } from '@/lib/share/cardApi'
import { createGetCardHandler } from '@/lib/share/handlers/card'

export const runtime = 'nodejs'
// 限流要读 cf-connecting-ip，缓存与预算都要现取 R2 绑定，不能被静态化
export const dynamic = 'force-dynamic'

export async function GET(req: Request, ctx: { params: Promise<{ pointId: string }> }) {
  try {
    const deps = await getCardDeps()
    return await createGetCardHandler(deps)(req, ctx)
  } catch (err) {
    console.error('[api/share/card] GET failed', err)
    return NextResponse.json({ error: '服务器错误' }, { status: 500 })
  }
}
