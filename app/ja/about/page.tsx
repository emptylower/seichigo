import type { Metadata } from 'next'
import { buildJaAlternates } from '@/lib/seo/alternates'
import { t } from '@/lib/i18n'

export const metadata: Metadata = {
  title: 'SeichiGoについて｜アニメ聖地巡礼ガイド',
  description:
    'SeichiGoは「1作品×1ルート」の聖地巡礼ガイドを提供：ナビ可能なスポットリスト、交通・撮影アドバイス、地域住民への配慮と持続可能な巡礼文化を重視。',
  alternates: buildJaAlternates({ zhPath: '/about' }),
  openGraph: {
    type: 'website',
    url: '/ja/about',
    title: 'SeichiGoについて',
    description:
      'SeichiGoは「1作品×1ルート」の聖地巡礼ガイドを提供：ナビ可能なスポットリスト、交通・撮影アドバイス、地域住民への配慮と持続可能な巡礼文化を重視。',
    images: ['/opengraph-image'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'SeichiGoについて',
    description:
      'SeichiGoは「1作品×1ルート」の聖地巡礼ガイドを提供：ナビ可能なスポットリスト、交通・撮影アドバイス、地域住民への配慮と持続可能な巡礼文化を重視。',
    images: ['/twitter-image'],
  },
}

export const revalidate = 86400
export const dynamic = 'force-static'

export default function AboutJaPage() {
  return (
    <div className="space-y-24 pb-20">
      {/* Hero Section */}
      <section className="relative pt-12 pb-16 text-center md:pt-24 md:pb-20">
        <div className="mx-auto max-w-3xl px-6">
          <h1 className="text-4xl font-extrabold tracking-tight text-gray-900 sm:text-5xl md:text-6xl">
            {t('pages.about.heroTitle', 'ja')}<span className="text-brand-600">{t('pages.about.heroTitleDimension', 'ja')}</span>{t('pages.about.heroTitleAnd', 'ja')}<span className="text-brand-600">{t('pages.about.heroTitleReality', 'ja')}</span>{t('pages.about.heroTitleSuffix', 'ja')}
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-gray-600 leading-relaxed md:text-xl">
            {t('pages.about.heroSubtitle', 'ja')}
            <br className="hidden sm:block" />
            {t('pages.about.heroSubtitleLine2', 'ja')}
          </p>
        </div>
        
        {/* Decorative Background Elements */}
        <div className="pointer-events-none absolute top-0 left-1/2 -z-10 -translate-x-1/2 opacity-30">
          <div className="h-96 w-96 rounded-full bg-brand-200 blur-3xl" />
        </div>
      </section>

      {/* Mission Section */}
      <section className="mx-auto max-w-5xl px-6">
        <div className="grid gap-12 md:grid-cols-3">
          <div className="space-y-4 rounded-2xl bg-gray-50 p-8 shadow-sm transition-shadow hover:shadow-md">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-100 text-brand-600">
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 7m0 13V7" />
              </svg>
            </div>
            <h3 className="text-xl font-bold text-gray-900">{t('pages.about.missionCard1Title', 'ja')}</h3>
            <p className="text-gray-600 leading-relaxed">
              {t('pages.about.missionCard1Description', 'ja')}
            </p>
          </div>

          <div className="space-y-4 rounded-2xl bg-gray-50 p-8 shadow-sm transition-shadow hover:shadow-md">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-purple-100 text-purple-600">
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
            </div>
            <h3 className="text-xl font-bold text-gray-900">{t('pages.about.missionCard2Title', 'ja')}</h3>
            <p className="text-gray-600 leading-relaxed">
              {t('pages.about.missionCard2Description', 'ja')}
            </p>
          </div>

          <div className="space-y-4 rounded-2xl bg-gray-50 p-8 shadow-sm transition-shadow hover:shadow-md">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-orange-100 text-orange-600">
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <h3 className="text-xl font-bold text-gray-900">{t('pages.about.missionCard3Title', 'ja')}</h3>
            <p className="text-gray-600 leading-relaxed">
              {t('pages.about.missionCard3Description', 'ja')}
            </p>
          </div>
        </div>
      </section>

      {/* Story Text */}
      <section className="mx-auto max-w-3xl px-6 text-center">
        <h2 className="text-2xl font-bold text-gray-900">{t('pages.about.whyTitle', 'ja')}</h2>
        <div className="mt-6 space-y-6 text-lg text-gray-600 leading-relaxed">
          <p>
            {t('pages.about.whyParagraph1', 'ja')}
          </p>
          <p>
            {t('pages.about.whyParagraph2', 'ja')}
          </p>
          <p className="font-serif text-2xl italic text-brand-600">
            "{t('pages.about.whyQuote', 'ja')}"
          </p>
        </div>
      </section>

      {/* Future & Contact */}
      <section className="mx-auto max-w-4xl px-6">
        <div className="overflow-hidden rounded-3xl bg-gray-900 text-white shadow-xl">
          <div className="grid md:grid-cols-2">
            <div className="bg-brand-600 p-10 md:p-12 text-white">
              <h3 className="text-2xl font-bold text-white">{t('pages.about.futureTitle', 'ja')}</h3>
              <p className="mt-4 text-white/90 leading-relaxed">
                {t('pages.about.futureDescription', 'ja')}
                <br /><br />
                {t('pages.about.futureDescriptionLine2', 'ja')}
              </p>
              <div className="mt-8 inline-block rounded-lg bg-white/20 px-4 py-2 text-sm font-medium text-white backdrop-blur-sm border border-white/20">
                {t('pages.about.futureComingSoon', 'ja')}
              </div>
            </div>
            <div className="bg-gray-800 p-10 md:p-12 text-white">
              <h3 className="text-2xl font-bold text-white">{t('pages.about.contactTitle', 'ja')}</h3>
              <p className="mt-4 text-gray-300 leading-relaxed">
                {t('pages.about.contactDescription', 'ja')}
              </p>
              <div className="mt-8">
                <a 
                  href="mailto:ljj231428@gmail.com" 
                  className="group inline-flex items-center gap-2 text-lg font-semibold text-white transition-colors hover:text-brand-300"
                >
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                  ljj231428@gmail.com
                  <span className="block h-px max-w-0 bg-brand-300 transition-all group-hover:max-w-full"></span>
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
