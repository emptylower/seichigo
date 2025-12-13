import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getServerAuthSession } from '@/lib/auth/session'
import { prisma } from '@/lib/db/prisma'
import { ADMIN_DEFAULT_PASSWORD, hashPassword, isAdminEmail, verifyPassword } from '@/lib/auth/admin'

const schema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(6),
})

export async function POST(req: Request) {
  const session = await getServerAuthSession()
  if (!session?.user?.id || !session.user.email) {
    return NextResponse.json({ error: '未登录' }, { status: 401 })
  }
  if (!isAdminEmail(session.user.email)) {
    return NextResponse.json({ error: '无权限' }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || '参数错误' }, { status: 400 })
  }

  const { currentPassword, newPassword } = parsed.data
  if (newPassword === currentPassword) {
    return NextResponse.json({ error: '新密码不能与旧密码相同' }, { status: 400 })
  }

  const user = await prisma.user.findUnique({ where: { id: session.user.id } })
  if (!user) {
    return NextResponse.json({ error: '用户不存在' }, { status: 404 })
  }

  const ok = user.passwordHash
    ? verifyPassword(currentPassword, user.passwordHash)
    : currentPassword === ADMIN_DEFAULT_PASSWORD
  if (!ok) {
    return NextResponse.json({ error: '当前密码不正确' }, { status: 400 })
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: hashPassword(newPassword),
      mustChangePassword: false,
    },
  })

  return NextResponse.json({ ok: true })
}
