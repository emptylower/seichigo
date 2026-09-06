import Link from 'next/link'
import { Check, Minus } from 'lucide-react'
import { t } from '@/lib/i18n'
import type { SupportedLocale } from '@/lib/i18n/types'

type Row = { key: string; free: string | boolean; standard: string | boolean; pro: string | boolean }

/** 功能对照表：布尔=打勾/横杠，字符串=文案键（在 Cell 里再翻） */
const ROWS: Row[] = [
  { key: 'rowPlanning', free: true, standard: true, pro: true },
  { key: 'rowSpots', free: true, standard: true, pro: true },
  { key: 'rowPlaces', free: true, standard: true, pro: true },
  { key: 'rowRestaurants', free: false, standard: true, pro: true },
  { key: 'rowTransit', free: 'transitFree', standard: 'transitStandard', pro: 'transitPro' },
  { key: 'rowHotels', free: false, standard: false, pro: true },
  { key: 'rowModels', free: false, standard: false, pro: true },
  { key: 'rowDays', free: 'daysFree', standard: 'daysStandard', pro: 'daysPro' },
  { key: 'rowUsage', free: 'usageFree', standard: 'usageStandard', pro: 'usagePro' },
]

function Cell({ value, locale }: { value: string | boolean; locale: SupportedLocale }) {
  if (value === true) return <Check className="mx-auto h-4 w-4 text-brand-600" aria-label={tx(locale, 'included')} />
  if (value === false) return <Minus className="mx-auto h-4 w-4 text-gray-300" aria-label={tx(locale, 'notIncluded')} />
  return <span className="text-sm text-gray-700">{tx(locale, value)}</span>
}

function tx(locale: SupportedLocale, key: string): string {
  return t(`pages.pricing.${key}`, locale)
}

export default function PricingTemplate({ locale }: { locale: SupportedLocale }) {
  const comingSoon = tx(locale, 'comingSoon')
  // /plan 是三语共用的非本地化路由（prefixPath 的 NON_LOCALIZED_PREFIXES 里），不加语言前缀
  const planHref = '/plan'
  const tiers = [
    { key: 'free', name: tx(locale, 'freeName'), price: '$0', period: '', badge: null, cta: { label: tx(locale, 'freeCta'), href: planHref, disabled: false, primary: false } },
    { key: 'standard', name: tx(locale, 'standardName'), price: '$9.9', period: tx(locale, 'standardPeriod'), badge: null, cta: { label: tx(locale, 'standardCta'), href: `${planHref}?upgrade=standard`, disabled: false, primary: true } },
    { key: 'pro', name: tx(locale, 'proName'), price: '', period: '', badge: comingSoon, cta: { label: comingSoon, href: '#', disabled: true, primary: false } },
  ]

  return (
    <main className="mx-auto max-w-5xl px-4 py-12">
      <h1 className="text-2xl font-bold text-gray-900">{tx(locale, 'title')}</h1>
      <p className="mt-2 text-sm text-gray-500">{tx(locale, 'subtitle')}</p>

      <div className="mt-8 grid gap-4 md:grid-cols-3">
        {tiers.map((tier) => (
          <section
            key={tier.key}
            className={`rounded-2xl border p-5 ${tier.cta.primary ? 'border-brand-300 bg-brand-50/40 shadow-sm' : 'border-pink-100 bg-white'} ${tier.cta.disabled ? 'opacity-70' : ''}`}
          >
            <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-900">
              {tier.name}
              {tier.badge ? (
                <span className="rounded-full border border-brand-200 bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-600">
                  {tier.badge}
                </span>
              ) : null}
            </h2>
            {tier.price ? (
              <p className="mt-2 text-2xl font-bold text-gray-900">
                {tier.price}
                <span className="text-sm font-normal text-gray-400">{tier.period}</span>
              </p>
            ) : null}
            {tier.cta.disabled ? (
              <button
                type="button"
                disabled
                className="mt-4 w-full cursor-not-allowed rounded-full bg-gray-200 px-4 py-2 text-sm font-medium text-gray-500"
              >
                {tier.cta.label}
              </button>
            ) : (
              <Link
                href={tier.cta.href}
                className={`mt-4 block w-full rounded-full px-4 py-2 text-center text-sm font-medium ${tier.cta.primary ? 'bg-brand-600 text-white hover:bg-brand-500' : 'border border-gray-300 text-gray-700 hover:bg-gray-50'}`}
              >
                {tier.cta.label}
              </Link>
            )}
          </section>
        ))}
      </div>

      <div className="mt-10 overflow-x-auto">
        <table className="w-full min-w-[640px] text-left">
          <thead>
            <tr className="border-b border-pink-100 text-sm text-gray-500">
              <th className="py-2 pr-4 font-medium">{tx(locale, 'featureHeader')}</th>
              <th className="py-2 text-center font-medium">{tx(locale, 'freeName')}</th>
              <th className="py-2 text-center font-medium">{tx(locale, 'standardName')}</th>
              <th className="py-2 text-center font-medium">
                {tx(locale, 'proName')}
                <span className="ml-1 rounded-full border border-brand-200 bg-brand-50 px-1.5 py-0.5 text-[10px] font-medium text-brand-600">
                  {comingSoon}
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr key={row.key} className="border-b border-pink-50">
                <td className="py-3 pr-4 text-sm text-gray-800">{tx(locale, row.key)}</td>
                <td className="py-3 text-center">
                  <Cell value={row.free} locale={locale} />
                </td>
                <td className="py-3 text-center">
                  <Cell value={row.standard} locale={locale} />
                </td>
                <td className="py-3 text-center">
                  <Cell value={row.pro} locale={locale} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-4 text-xs text-gray-500">{tx(locale, 'footnoteComingSoon')}</p>
      <p className="mt-2 text-xs text-gray-400">{tx(locale, 'footnotePayment')}</p>
    </main>
  )
}
