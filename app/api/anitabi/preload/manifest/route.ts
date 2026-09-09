export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { getAnitabiApiDeps } from '@/lib/anitabi/api'
import { getCfBindings } from '@/lib/anitabi/cf/bindings'
import { createHandlers } from '@/lib/anitabi/handlers/preloadManifest'

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
    const deps = await getAnitabiApiDeps()
    // 边缘缓存 put 需要 ctx.waitUntil（无绑定的 next dev / vitest 里为 undefined，退化为直通）
    const bindings = getCfBindings()
    return createHandlers({
      ...deps,
      ...(bindings?.ctx ? { ctx: bindings.ctx as typeof deps.ctx } : {}),
    }).GET(req)
  } catch (err) {
    console.error('[api/anitabi/preload/manifest] GET failed', err)
    return routeError(err)
  }
}
