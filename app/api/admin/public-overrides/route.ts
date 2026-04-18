import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { getServerAuthSession } from '@/lib/auth/session'
import { createPublicOverride, getAffectedPublicPaths, listPublicOverrides } from '@/lib/publicOverride/service'

function routeError(err: unknown) {
  const message = String((err as any)?.message || '')
  return NextResponse.json({ error: message || '服务器错误' }, { status: 400 })
}

async function requireAdmin() {
  const session = await getServerAuthSession()
  if (!session?.user?.isAdmin) {
    return null
  }
  return session
}

export async function GET() {
  const session = await requireAdmin()
  if (!session) {
    return NextResponse.json({ error: '无权限' }, { status: 403 })
  }

  try {
    const items = await listPublicOverrides()
    return NextResponse.json({ ok: true, items })
  } catch (error) {
    console.error('[api/admin/public-overrides] GET failed', error)
    return routeError(error)
  }
}

export async function POST(req: Request) {
  const session = await requireAdmin()
  if (!session) {
    return NextResponse.json({ error: '无权限' }, { status: 403 })
  }

  try {
    const body = await req.json()
    const item = await createPublicOverride(body, session.user.id)
    for (const path of getAffectedPublicPaths(item.targetType, item.targetKey)) {
      revalidatePath(path)
    }
    return NextResponse.json({ ok: true, item }, { status: 201 })
  } catch (error) {
    console.error('[api/admin/public-overrides] POST failed', error)
    return routeError(error)
  }
}
