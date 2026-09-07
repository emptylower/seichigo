import { ChevronDown } from 'lucide-react'
import type { SiteLocale } from '@/components/layout/SiteShell'
import { buildFAQPageJsonLd } from '@/lib/seo/faqJsonLd'
import PlaceJsonLd from '@/lib/seo/placeJsonLd'
import { t } from '@/lib/i18n'

/**
 * 第六屏 FAQ（本轮重做）：居中 eyebrow + 标题 + 副标题，下面两列问答卡。
 * 仍用 <details>/<summary>（第一条默认展开），卡片左侧圆形序号、右侧 ChevronDown
 * 展开箭头；FAQPage JSON-LD 保留。问答文案与产品事实一致（免费档 3 天、
 * 标准版 7 天、点位来自 Anitabi + 用户投稿），不用营销话术。
 */
export default function HomeFaq({ locale }: { locale: SiteLocale }) {
  const faqItems = [
    { question: t('pages.home.faqQ1', locale), answer: t('pages.home.faqA1', locale) },
    { question: t('pages.home.faqQ2', locale), answer: t('pages.home.faqA2', locale) },
    { question: t('pages.home.faqQ3', locale), answer: t('pages.home.faqA3', locale) },
    { question: t('pages.home.faqQ4', locale), answer: t('pages.home.faqA4', locale) },
    { question: t('pages.home.faqQ5', locale), answer: t('pages.home.faqA5', locale) },
  ]

  return (
    <section>
      <PlaceJsonLd data={buildFAQPageJsonLd(faqItems)} keyPrefix={`home-faq-${locale}`} />

      <div className="text-center">
        <p className="text-xs font-semibold tracking-wide text-brand-600">{t('pages.home.faqEyebrow', locale)}</p>
        <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-gray-900 lg:text-4xl">
          {t('pages.home.faqSectionTitle', locale)}
        </h2>
        <p className="mx-auto mt-3 max-w-2xl text-sm text-gray-600 sm:text-base">
          {t('pages.home.faqSectionSubtitle', locale)}
        </p>
      </div>

      <div className="mt-8 grid gap-4 md:grid-cols-2">
        {faqItems.map((item, idx) => (
          <details
            key={`${item.question}-${idx}`}
            open={idx === 0}
            className="group self-start rounded-2xl border border-gray-200 bg-white p-5"
          >
            <summary className="flex cursor-pointer list-none items-center gap-3 text-left [&::-webkit-details-marker]:hidden">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-50 text-sm font-bold text-brand-700">
                {String(idx + 1).padStart(2, '0')}
              </span>
              <span className="min-w-0 flex-1 text-sm font-semibold text-gray-900 sm:text-base">{item.question}</span>
              <ChevronDown
                className="h-4 w-4 shrink-0 text-gray-400 transition-transform duration-200 group-open:rotate-180"
                aria-hidden="true"
              />
            </summary>
            <p className="mt-3 pl-11 text-sm leading-7 text-gray-600">{item.answer}</p>
          </details>
        ))}
      </div>
    </section>
  )
}
