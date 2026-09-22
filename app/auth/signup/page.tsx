import { Suspense } from 'react'
import SignUpClient from './ui'
import type { Metadata } from 'next'
import { t } from '@/lib/i18n'
import { getAuthLocale } from '../getAuthLocale'

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getAuthLocale()
  return {
    title: t('auth.signup.title', locale),
    description: t('auth.signup.description', locale),
    alternates: { canonical: '/auth/signup' },
  }
}

export default async function SignUpPage() {
  const locale = await getAuthLocale()
  return (
    <Suspense fallback={<div className="mx-auto max-w-md px-4 py-12 text-gray-600">{t('auth.signup.loading', locale)}</div>}>
      <SignUpClient locale={locale} />
    </Suspense>
  )
}
