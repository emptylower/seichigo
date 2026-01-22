import { NextResponse } from 'next/server'
import { getServerAuthSession } from '@/lib/auth/session'
import { prisma } from '@/lib/db/prisma'

export const runtime = 'nodejs'

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; aliasId: string }> }) {
  const session = await getServerAuthSession()
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: '无权限' }, { status: 403 })
  }

  const { id: cityId, aliasId } = await params

  const hit = await prisma.cityAlias.findUnique({ where: { id: aliasId }, select: { id: true, cityId: true } })
  if (!hit || hit.cityId !== cityId) {
    return NextResponse.json({ error: '未找到' }, { status: 404 })
  }

  await prisma.cityAlias.delete({ where: { id: aliasId } })
  return NextResponse.json({ ok: true })
}
