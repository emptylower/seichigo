import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getServerAuthSession } from '@/lib/auth/session'
import { prisma } from '@/lib/db/prisma'
import { hashPassword } from '@/lib/auth/admin'

export const runtime = 'nodejs'

const schema = z.object({
  newPassword: z.string().min(6),
})

export async function POST(req: Request) {
  const session = await getServerAuthSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: '未登录' }, { status: 401 })
  }

  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || '参数错误' }, { status: 400 })
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { passwordHash: true },
  })
  if (!user) {
    return NextResponse.json({ error: '用户不存在' }, { status: 404 })
  }
  if (user.passwordHash) {
    return NextResponse.json({ ok: true })
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: {
      passwordHash: hashPassword(parsed.data.newPassword),
      mustChangePassword: false,
    },
  })

  return NextResponse.json({ ok: true })
}

