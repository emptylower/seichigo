import { NextResponse } from 'next/server'
import { createGetPointContextHandler } from '@/lib/share/handlers/pointContext'
import { getPointContextDeps } from '@/lib/share/pointContextApi'

export const runtime = 'nodejs'
// 限流要读 cf-connecting-ip，且首次访问会写缓存表，不能被静态化
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  try {
    const deps = await getPointContextDeps()
    return await createGetPointContextHandler(deps)(req)
  } catch (err) {
    console.error('[api/share/point-context] GET failed', err)
    return NextResponse.json({ error: '服务器错误' }, { status: 500 })
  }
}
