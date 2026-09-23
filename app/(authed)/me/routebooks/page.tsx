import { getServerAuthSession } from '@/lib/auth/session'
import RouteBooksClient from './ui'
import type { Metadata } from 'next'
import MeSectionShell from '@/components/me/MeSectionShell'
import { getLocale } from '@/lib/i18n/getLocale'
import { t } from '@/lib/i18n'

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale()
  return {
    title: t('routebook.meta.listTitle', locale),
    description: t('routebook.meta.listDescription', locale),
    alternates: { canonical: '/me/routebooks' },
  }
}
export const dynamic = 'force-dynamic'

export default async function RouteBooksPage() {
  const locale = await getLocale()
  let session: any = null
  try {
    if (process.env.DATABASE_URL) {
      session = await getServerAuthSession()
    }
  } catch {
    session = null
  }

  if (!session?.user?.id) {
    return (
      <MeSectionShell
        activeTab="routebooks"
        locale={locale}
        title={t('routebook.list.pageTitle', locale)}
        description={t('routebook.list.pageDesc', locale)}
      >
        <div className="rounded-3xl border border-slate-200 bg-white/90 p-6 shadow-sm">
          <p className="text-gray-600">{t('routebook.list.loginRequired', locale)}</p>
          <a className="btn-primary mt-4 inline-flex w-fit no-underline" href={`/auth/signin?callbackUrl=${encodeURIComponent('/me/routebooks')}`}>
            {t('routebook.common.signIn', locale)}
          </a>
        </div>
      </MeSectionShell>
    )
  }

  return (
    <MeSectionShell
      activeTab="routebooks"
      locale={locale}
      title={t('routebook.list.pageTitle', locale)}
      description={t('routebook.list.pageDesc', locale)}
    >
      <RouteBooksClient locale={locale} />
    </MeSectionShell>
  )
}
