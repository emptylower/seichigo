import { NextResponse } from 'next/server'
import { getProfileApiDeps } from '@/lib/profile/api'
import { createHandlers } from '@/lib/profile/handlers'

export const runtime = 'nodejs'

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

export async function GET(req: Request) {
  try {
    const deps = await getProfileApiDeps()
    const handlers = createHandlers(deps)
    return await handlers.GET(req)
  } catch (err) {
    console.error('[api/me/profile] GET failed', err)
    return routeError(err)
  }
}

export async function PATCH(req: Request) {
  try {
    const deps = await getProfileApiDeps()
    const handlers = createHandlers(deps)
    return await handlers.PATCH(req)
  } catch (err) {
    console.error('[api/me/profile] PATCH failed', err)
    return routeError(err)
  }
}
