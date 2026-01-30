import { NextResponse } from 'next/server'
import { getWaitlistApiDeps } from '@/lib/waitlist/api'
import { createHandlers } from '@/lib/waitlist/handlers/adminList'

export const runtime = 'nodejs'

function getErrCode(err: unknown): string | null {
  if (!err || typeof err !== 'object') return null
  const code = (err as { code?: unknown }).code
  return typeof code === 'string' ? code : null
}

function getErrMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (!err || typeof err !== 'object') return String(err || '')
  const msg = (err as { message?: unknown }).message
  return typeof msg === 'string' ? msg : ''
}

function routeError(err: unknown) {
  const code = getErrCode(err)
  if (code === 'P2021' || code === 'P2022') {
    return NextResponse.json({ error: '数据库结构未更新，请先执行迁移（prisma migrate deploy）后重试' }, { status: 503 })
  }
  const msg = getErrMessage(err)
  if (msg.includes('Environment variable not found') && msg.includes('DATABASE_URL')) {
    return NextResponse.json({ error: '数据库未配置' }, { status: 503 })
  }
  return NextResponse.json({ error: '服务器错误' }, { status: 500 })
}

export async function GET(req: Request) {
  try {
    const deps = await getWaitlistApiDeps()
    return createHandlers(deps).GET(req)
  } catch (err) {
    console.error('[api/admin/waitlist] GET failed', err)
    return routeError(err)
  }
}
