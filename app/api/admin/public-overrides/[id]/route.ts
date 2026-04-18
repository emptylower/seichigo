import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { getServerAuthSession } from '@/lib/auth/session'
import { deletePublicOverride, getAffectedPublicPaths } from '@/lib/publicOverride/service'

function routeError(err: unknown) {
  const message = String((err as any)?.message || '')
  return NextResponse.json({ error: message || '服务器错误' }, { status: 400 })
}

export async function DELETE(_: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getServerAuthSession()
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: '无权限' }, { status: 403 })
  }

  try {
    const { id } = await context.params
    const deleted = await deletePublicOverride(id)
    for (const path of getAffectedPublicPaths(deleted.targetType, deleted.targetKey)) {
      revalidatePath(path)
    }
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[api/admin/public-overrides/[id]] DELETE failed', error)
    return routeError(error)
  }
}
