import type { SiteLocale } from '@/components/layout/SiteShell'
import { buildFAQPageJsonLd } from '@/lib/seo/faqJsonLd'
import PlaceJsonLd from '@/lib/seo/placeJsonLd'
import { t } from '@/lib/i18n'

/** 首页 FAQ（含 FAQPage JSON-LD）：第十二轮从 HomePageTemplate 拆出，内容不变。 */
export default function HomeFaq({ locale }: { locale: SiteLocale }) {
  const faqItems = [
    { question: t('pages.home.faqQ1', locale), answer: t('pages.home.faqA1', locale) },
    { question: t('pages.home.faqQ2', locale), answer: t('pages.home.faqA2', locale) },
    { question: t('pages.home.faqQ3', locale), answer: t('pages.home.faqA3', locale) },
    { question: t('pages.home.faqQ4', locale), answer: t('pages.home.faqA4', locale) },
    { question: t('pages.home.faqQ5', locale), answer: t('pages.home.faqA5', locale) },
  ]

  return (
    <section className="mx-auto max-w-3xl px-4 sm:px-6">
      <PlaceJsonLd data={buildFAQPageJsonLd(faqItems)} keyPrefix={`home-faq-${locale}`} />
      <div className="space-y-2">
        <h2 className="text-xl font-bold tracking-tight text-gray-900 sm:text-2xl">{t('pages.home.faqSectionTitle', locale)}</h2>
        <p className="text-sm leading-relaxed text-gray-600">{t('pages.home.faqSectionSubtitle', locale)}</p>
      </div>

      <div className="mt-5 space-y-2">
        {faqItems.map((item, idx) => (
          <details
            key={`${item.question}-${idx}`}
            className="group rounded-2xl border border-gray-200 bg-white p-4 open:border-brand-200"
          >
            <summary className="flex cursor-pointer list-none items-start gap-3 text-left [&::-webkit-details-marker]:hidden">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-50 text-[11px] font-bold text-brand-700">
                {String(idx + 1).padStart(2, '0')}
              </span>
              <span className="flex-1 text-sm font-semibold leading-6 text-gray-900 sm:text-base">{item.question}</span>
              <span className="relative mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700">
                <span className="absolute h-0.5 w-2.5 rounded-full bg-current" />
                <span className="absolute h-2.5 w-0.5 rounded-full bg-current transition-transform duration-200 group-open:scale-y-0" />
              </span>
            </summary>
            <p className="mt-2 pl-9 pr-6 text-sm leading-7 text-gray-600">{item.answer}</p>
          </details>
        ))}
      </div>
    </section>
  )
}
