import type { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  const base = (process.env.SITE_URL || 'http://localhost:3000').replace(/\/$/, '')
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/auth/', '/admin/', '/submit', '/me/', '/api/'],
    },
    sitemap: `${base}/sitemap.xml`,
  }
}
