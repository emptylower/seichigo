import type { MetadataRoute } from 'next'
import { getSiteOrigin } from '@/lib/seo/site'

export default function robots(): MetadataRoute.Robots {
  const base = getSiteOrigin()
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/auth/', '/admin/', '/submit', '/me/', '/api/'],
    },
    sitemap: `${base}/sitemap.xml`,
  }
}
