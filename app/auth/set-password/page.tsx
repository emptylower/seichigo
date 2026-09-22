import { redirect } from 'next/navigation'
import { getServerAuthSession } from '@/lib/auth/session'
import { prisma } from '@/lib/db/prisma'
import SetPasswordClient from './ui'
import type { Metadata } from 'next'
import { t } from '@/lib/i18n'
import { getAuthLocale } from '../getAuthLocale'

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getAuthLocale()
  return {
    title: t('auth.setPassword.title', locale),
    description: t('auth.setPassword.description', locale),
    alternates: { canonical: '/auth/set-password' },
  }
}

export default async function SetPasswordPage() {
  const locale = await getAuthLocale()
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

  return <SetPasswordClient email={session.user.email} locale={locale} />
}
