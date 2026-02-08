import Link from 'next/link'
import { prefixPath } from '@/components/layout/prefixPath'
import type { SiteLocale } from '@/components/layout/SiteShell'
import { t } from '@/lib/i18n'
import type { HomeStarterItem } from '@/lib/home/types'

const STEP_STYLES: Record<HomeStarterItem['id'], string> = {
  anime: 'from-brand-500/15 to-brand-100/10',
  city: 'from-sky-500/15 to-cyan-100/20',
  resources: 'from-violet-500/15 to-fuchsia-100/20',
}

export default function HomeStarterSteps({
  steps,
  locale,
}: {
  steps: HomeStarterItem[]
  locale: SiteLocale
}) {
  if (!steps.length) return null

  return (
    <section className="space-y-6 max-w-7xl mx-auto px-6">
      <div className="flex items-center justify-between px-1 border-l-4 border-brand-500 pl-3">
        <h2 className="text-2xl font-bold tracking-tight text-gray-900">{t('pages.home.starterTitle', locale)}</h2>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {steps.map((step, index) => (
          <article
            key={step.id}
            className={`relative overflow-hidden rounded-2xl border border-gray-200 bg-gradient-to-br ${STEP_STYLES[step.id]} p-5 shadow-sm`}
          >
            <div className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white text-sm font-bold text-gray-700 ring-1 ring-gray-200">
              {index + 1}
            </div>
            <h3 className="mt-3 text-lg font-semibold text-gray-900">{t(step.titleKey, locale)}</h3>
            <p className="mt-2 text-sm leading-6 text-gray-600">{t(step.descKey, locale)}</p>
            <Link
              href={prefixPath(step.href, locale)}
              className="mt-4 inline-flex items-center text-sm font-semibold text-brand-700 hover:text-brand-800"
            >
              {t(step.ctaKey, locale)}
            </Link>
          </article>
        ))}
      </div>
    </section>
  )
}
