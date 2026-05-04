export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { getAnitabiApiDeps } from '@/lib/anitabi/api'
import { createHandlers } from '@/lib/anitabi/handlers/adminImageMirrorStatus'

function routeError(err: unknown) {
  const code = (err as { code?: unknown } | null)?.code
  if (code === 'P2021' || code === 'P2022') {
    return NextResponse.json({ error: '数据库结构未更新，请先执行迁移（prisma migrate deploy）后重试' }, { status: 503 })
  }

  const message = String((err as { message?: unknown } | null)?.message || '')
  if (
    message.includes('Environment variable not found')
    && message.includes('DATABASE_URL')
  ) {
    return NextResponse.json({ error: '数据库未配置' }, { status: 503 })
  }

  return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
}

export async function GET() {
  try {
    const deps = await getAnitabiApiDeps()
    return await createHandlers(deps).GET()
  } catch (err) {
    console.error('[api/admin/anitabi/image-mirror/status] GET failed', err)
    return routeError(err)
  }
}
