import type { MetadataRoute } from 'next'
import { getSiteOrigin } from '@/lib/seo/site'

export default function robots(): MetadataRoute.Robots {
  const base = getSiteOrigin()
  return {
    rules: {
      userAgent: '*',
      // /s/[code] 的 OG 图走 /api/share/*，需要在 /api/ 的 disallow 之上显式放行
      allow: ['/', '/api/share/img/', '/api/share/photo/'],
      disallow: ['/auth/', '/admin/', '/submit', '/me/', '/api/'],
    },
    sitemap: `${base}/sitemap.xml`,
  }
}
