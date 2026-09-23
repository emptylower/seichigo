import { getServerAuthSession } from '@/lib/auth/session'
import RouteBookDetailClient from './ui'
import type { Metadata } from 'next'
import { getLocale } from '@/lib/i18n/getLocale'
import { t } from '@/lib/i18n'

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale()
  return {
    title: t('routebook.meta.detailTitle', locale),
    description: t('routebook.meta.detailDescription', locale),
    robots: { index: false, follow: false },
  }
}
export const dynamic = 'force-dynamic'

export default async function RouteBookDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
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
      <section data-layout-wide="true" data-layout-immersive="true" className="min-h-dvh px-4 py-10 sm:px-6">
        <div className="mx-auto flex min-h-[70vh] max-w-xl items-center justify-center">
          <div className="w-full rounded-[32px] border border-pink-100/90 bg-white/90 p-8 shadow-[0_30px_60px_-40px_rgba(15,23,42,0.42)]">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{t('routebook.meta.detailTitle', locale)}</h1>
            <p className="mt-2 text-sm leading-6 text-slate-600">{t('routebook.detail.loginRequired', locale)}</p>
            <a className="btn-primary mt-5 inline-flex w-fit no-underline" href={`/auth/signin?callbackUrl=${encodeURIComponent(`/me/routebooks/${id}`)}`}>
              {t('routebook.common.signIn', locale)}
            </a>
          </div>
        </div>
      </section>
    )
  }

  return <RouteBookDetailClient id={id} locale={locale} />
}
