export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { getAnitabiApiDeps } from '@/lib/anitabi/api'
import { createHandlers } from '@/lib/anitabi/handlers/chunks'

function routeError(err: unknown) {
  const code = (err as any)?.code
  if (code === 'P2021' || code === 'P2022') {
    return NextResponse.json({ error: '数据库结构未更新，请先执行迁移（prisma migrate deploy）后重试' }, { status: 503 })
  }
  const msg = String((err as any)?.message || '')
  if (msg.includes('Environment variable not found') && msg.includes('DATABASE_URL')) {
    return NextResponse.json({ error: '数据库未配置' }, { status: 503 })
  }
  return NextResponse.json({ error: '服务器错误' }, { status: 500 })
}

export async function GET(req: Request, { params }: { params: Promise<{ index: string }> }) {
  try {
    const { index } = await params
    const deps = await getAnitabiApiDeps()
    return createHandlers(deps).GET(req, { index })
  } catch (err) {
    console.error('[api/anitabi/chunks/[index]] GET failed', err)
    return routeError(err)
  }
}
