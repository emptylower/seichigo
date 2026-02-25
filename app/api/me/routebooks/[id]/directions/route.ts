import { NextResponse } from 'next/server'
import { getDirectionsApiDeps } from '@/lib/directions/api'
import { createHandlers } from '@/lib/directions/handlers/directions'

export const runtime = 'nodejs'

function routeError(err: unknown) {
  const msg =
    typeof err === 'object' && err !== null && 'message' in err
      ? (err as { message: string }).message
      : ''

  if (msg.includes('Environment variable not found') && msg.includes('DATABASE_URL')) {
    return NextResponse.json({ error: '数据库未配置' }, { status: 503 })
  }

  return NextResponse.json({ error: '服务器错误' }, { status: 500 })
}

export async function GET(req: Request, _ctx: { params: Promise<{ id: string }> }) {
  try {
    const deps = await getDirectionsApiDeps()
    return await createHandlers(deps).GET(req)
  } catch (err) {
    console.error('[api/me/routebooks/[id]/directions] GET failed', err)
    return routeError(err)
  }
}
