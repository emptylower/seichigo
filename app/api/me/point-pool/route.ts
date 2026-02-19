import { NextResponse } from 'next/server'
import { getPointPoolApiDeps } from '@/lib/pointPool/api'
import { createHandlers } from '@/lib/pointPool/handlers/pointPool'

export const runtime = 'nodejs'

type UnknownRecord = Record<string, unknown>

function isRecord(v: unknown): v is UnknownRecord {
  return typeof v === 'object' && v !== null
}

function getErrorCode(err: unknown): string {
  if (!isRecord(err)) return ''
  return typeof err.code === 'string' ? err.code : ''
}

function getErrorMessage(err: unknown): string {
  if (!isRecord(err)) return ''
  return typeof err.message === 'string' ? err.message : ''
}

function routeError(err: unknown) {
  const code = getErrorCode(err)
  if (code === 'P2021' || code === 'P2022') {
    return NextResponse.json({ error: '数据库结构未更新，请先执行迁移（prisma migrate deploy）后重试' }, { status: 503 })
  }

  const msg = getErrorMessage(err)
  if (msg.includes('Environment variable not found') && msg.includes('DATABASE_URL')) {
    return NextResponse.json({ error: '数据库未配置' }, { status: 503 })
  }

  return NextResponse.json({ error: '服务器错误' }, { status: 500 })
}

export async function GET(req: Request) {
  try {
    const deps = await getPointPoolApiDeps()
    return await createHandlers(deps).GET(req)
  } catch (err) {
    console.error('[api/me/point-pool] GET failed', err)
    return routeError(err)
  }
}

export async function PUT(req: Request) {
  try {
    const deps = await getPointPoolApiDeps()
    return await createHandlers(deps).PUT(req)
  } catch (err) {
    console.error('[api/me/point-pool] PUT failed', err)
    return routeError(err)
  }
}

export async function DELETE(req: Request) {
  try {
    const deps = await getPointPoolApiDeps()
    return await createHandlers(deps).DELETE(req)
  } catch (err) {
    console.error('[api/me/point-pool] DELETE failed', err)
    return routeError(err)
  }
}
