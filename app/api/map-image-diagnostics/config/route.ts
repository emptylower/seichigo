export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { getMapImageDiagApiDeps } from '@/lib/mapImageDiag/api'
import { getMapImageDiagControl } from '@/lib/mapImageDiag/service'

function routeError(err: unknown) {
  const code = (err as any)?.code
  if (code === 'P2021' || code === 'P2022') {
    return NextResponse.json({ error: '数据库结构未更新，请先执行迁移（prisma migrate deploy）后重试' }, { status: 503 })
  }

  const msg = String((err as any)?.message || '')
  if (msg.includes('Environment variable not found') && msg.includes('DATABASE_URL')) {
    return NextResponse.json({ error: '数据库未配置' }, { status: 503 })
  }

  return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
}

export async function GET() {
  try {
    const deps = await getMapImageDiagApiDeps()
    const config = await getMapImageDiagControl(deps)
    return NextResponse.json({ ok: true, config })
  } catch (err) {
    const code = (err as any)?.code
    if (code === 'P2021' || code === 'P2022') {
      return NextResponse.json({
        ok: true,
        config: {
          fullCaptureEnabled: false,
          updatedAt: null,
        },
        warning: '数据库结构未更新，当前仅支持本浏览器临时全量扫描。',
      })
    }
    console.error('[api/map-image-diagnostics/config] GET failed', err)
    return routeError(err)
  }
}
