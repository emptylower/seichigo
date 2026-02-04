import { NextResponse } from 'next/server'
import { getAiApiDeps } from '@/lib/ai/api'
import { createHandlers } from '@/lib/ai/handlers/notFound'

export const runtime = 'nodejs'

function getErrorCode(err: unknown): string | undefined {
  if (typeof err !== 'object' || err == null) return
  if (!('code' in err)) return
  const code = (err as { code?: unknown }).code
  return typeof code === 'string' ? code : undefined
}

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  return ''
}

function routeError(err: unknown) {
  const code = getErrorCode(err)
  if (code === 'P2021' || code === 'P2022') {
    return NextResponse.json({ error: '数据库结构未更新,请先执行迁移(prisma migrate deploy)后重试' }, { status: 503 })
  }

  const msg = getErrorMessage(err)
  if (msg.includes('Environment variable not found') && msg.includes('DATABASE_URL')) {
    return NextResponse.json({ error: '数据库未配置' }, { status: 503 })
  }

  return NextResponse.json({ error: '服务器错误' }, { status: 500 })
}

type Ctx = { params: Promise<{ path: string[] }> }

async function handle(req: Request, ctx: Ctx) {
  const deps = await getAiApiDeps()
  const handlers = createHandlers(deps)

  switch (req.method) {
    case 'GET':
      return handlers.GET(req, ctx)
    case 'POST':
      return handlers.POST(req, ctx)
    case 'PUT':
      return handlers.PUT(req, ctx)
    case 'PATCH':
      return handlers.PATCH(req, ctx)
    case 'DELETE':
      return handlers.DELETE(req, ctx)
    default:
      return NextResponse.json({ error: 'Method Not Allowed' }, { status: 405 })
  }
}

export async function GET(req: Request, ctx: Ctx) {
  try {
    return await handle(req, ctx)
  } catch (err) {
    console.error('[api/ai/*] GET failed', err)
    return routeError(err)
  }
}

export async function POST(req: Request, ctx: Ctx) {
  try {
    return await handle(req, ctx)
  } catch (err) {
    console.error('[api/ai/*] POST failed', err)
    return routeError(err)
  }
}

export async function PUT(req: Request, ctx: Ctx) {
  try {
    return await handle(req, ctx)
  } catch (err) {
    console.error('[api/ai/*] PUT failed', err)
    return routeError(err)
  }
}

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    return await handle(req, ctx)
  } catch (err) {
    console.error('[api/ai/*] PATCH failed', err)
    return routeError(err)
  }
}

export async function DELETE(req: Request, ctx: Ctx) {
  try {
    return await handle(req, ctx)
  } catch (err) {
    console.error('[api/ai/*] DELETE failed', err)
    return routeError(err)
  }
}
