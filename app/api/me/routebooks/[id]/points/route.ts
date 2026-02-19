import { NextResponse } from 'next/server'
import { getRouteBookApiDeps } from '@/lib/routeBook/api'
import { createHandlers } from '@/lib/routeBook/handlers/routebookPoints'
import { SortedZoneLimitError } from '@/lib/routeBook/repo'

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
  if (err instanceof SortedZoneLimitError) {
    return NextResponse.json({ error: `已排序点位已达上限（${err.limit}）` }, { status: 400 })
  }

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

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const deps = await getRouteBookApiDeps()
    return await createHandlers(deps).POST(req, ctx)
  } catch (err) {
    console.error('[api/me/routebooks/[id]/points] POST failed', err)
    return routeError(err)
  }
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const deps = await getRouteBookApiDeps()
    return await createHandlers(deps).DELETE(req, ctx)
  } catch (err) {
    console.error('[api/me/routebooks/[id]/points] DELETE failed', err)
    return routeError(err)
  }
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const deps = await getRouteBookApiDeps()
    return await createHandlers(deps).PATCH(req, ctx)
  } catch (err) {
    console.error('[api/me/routebooks/[id]/points] PATCH failed', err)
    return routeError(err)
  }
}
