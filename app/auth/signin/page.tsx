import { Suspense } from 'react'
import SignInClient from './ui'
import type { Metadata } from 'next'
import { t } from '@/lib/i18n'
import { getAuthLocale } from '../getAuthLocale'

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getAuthLocale()
  return {
    title: t('auth.signin.title', locale),
    description: t('auth.signin.description', locale),
    alternates: { canonical: '/auth/signin' },
  }
}

export default async function SignInPage() {
  const locale = await getAuthLocale()
  return (
    <Suspense fallback={<div className="mx-auto max-w-md px-4 py-12 text-gray-600">{t('auth.signin.loading', locale)}</div>}>
      <SignInClient locale={locale} />
    </Suspense>
  )
}
