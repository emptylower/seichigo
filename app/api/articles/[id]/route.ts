import { NextResponse } from 'next/server'
import { getArticleApiDeps } from '@/lib/article/api'
import { createHandlers } from '@/lib/article/handlers/articleById'

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

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const deps = await getArticleApiDeps()
    return createHandlers(deps).GET(req, ctx)
  } catch (err) {
    console.error('[api/articles/[id]] GET failed', err)
    return routeError(err)
  }
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const deps = await getArticleApiDeps()
    return createHandlers(deps).PATCH(req, ctx)
  } catch (err) {
    console.error('[api/articles/[id]] PATCH failed', err)
    return routeError(err)
  }
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const deps = await getArticleApiDeps()
    return createHandlers(deps).DELETE(req, ctx)
  } catch (err) {
    console.error('[api/articles/[id]] DELETE failed', err)
    return routeError(err)
  }
}
