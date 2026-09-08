import { getSiteOrigin } from '@/lib/seo/site'
import { CONTACT_EMAIL } from '@/lib/email/addresses'

type JsonLdObject = Record<string, any>

/**
 * 首页专属的 WebSite 节点：带 SearchAction，把「说一句话开始规划」声明成站内
 * 搜索入口（`/plan/start?draft=…`）。`@id` 与全站 WebSite 同源，搜索引擎按 @id 合并。
 */
export function buildHomeWebSiteJsonLd(): JsonLdObject {
  const origin = getSiteOrigin()
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': `${origin}#website`,
    name: 'SeichiGo',
    url: origin,
    inLanguage: ['zh', 'en', 'ja'],
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${origin}/plan/start?draft={search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
  }
}

export function buildOrganizationJsonLd(): JsonLdObject {
  const origin = getSiteOrigin()
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'SeichiGo',
    url: origin,
    // Keep as URL string for broad validator compatibility.
    logo: `${origin}/brand/icons/icon-512.png?v=2`,
    sameAs: [
      'https://x.com/xixingshu',
      'https://github.com/seichigo',
    ],
    contactPoint: {
      '@type': 'ContactPoint',
      contactType: 'customer support',
      email: CONTACT_EMAIL,
    },
  }
}
