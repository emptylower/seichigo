import { getSiteOrigin } from '@/lib/seo/site'

type JsonLdObject = Record<string, any>

export function buildWebSiteJsonLd(): JsonLdObject {
  const origin = getSiteOrigin()
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'SeichiGo',
    url: origin,
    description: '用好读的长文、精致排版和实用的地点列表，帮动漫爱好者完成第一次圣地巡礼的想象与规划。',
    inLanguage: ['zh', 'en'],
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
    logo: `${origin}/brand/app-logo.png`,
    contactPoint: {
      '@type': 'ContactPoint',
      contactType: 'customer support',
      email: 'ljj231428@gmail.com',
    },
  }
}
