import { redirect } from 'next/navigation'
import { getServerAuthSession } from '@/lib/auth/session'
import { prisma } from '@/lib/db/prisma'
import SetPasswordClient from './ui'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '设置密码',
  description: '为你的账号设置密码，便于后续登录。',
  alternates: { canonical: '/auth/set-password' },
}

export default async function SetPasswordPage() {
  const session = await getServerAuthSession()
  if (!session?.user?.id || !session.user.email) {
    redirect('/auth/signin?callbackUrl=%2Fauth%2Fset-password')
  }

  const user = await prisma.user
    .findUnique({ where: { id: session.user.id }, select: { passwordHash: true } })
    .catch(() => null)

  if (user?.passwordHash) {
    redirect('/')
  }

  return <SetPasswordClient email={session.user.email} />
}
