import type { MetadataRoute } from 'next'
import { getAllPublicPosts } from '@/lib/posts/getAllPublicPosts'
import { getAllAnime } from '@/lib/anime/getAllAnime'
import { listCitiesForIndex } from '@/lib/city/db'
import { getAllLinkAssets } from '@/lib/linkAsset/getAllLinkAssets'
import { getSiteOrigin } from '@/lib/seo/site'

export const runtime = 'nodejs'
export const revalidate = 0

function toLastModified(input?: string): Date | undefined {
  const raw = typeof input === 'string' ? input.trim() : ''
  if (!raw) return undefined
  const dt = new Date(raw)
  if (!Number.isFinite(dt.getTime())) return undefined
  return dt
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = getSiteOrigin()
  const posts = await getAllPublicPosts('zh')
  const anime = await getAllAnime().catch(() => [])
  const cities = await listCitiesForIndex().catch(() => [])
  const resources = await getAllLinkAssets().catch(() => [])

  const items: MetadataRoute.Sitemap = [
    { url: `${base}/`, changeFrequency: 'weekly', priority: 0.8, alternates: { languages: { zh: `${base}/`, en: `${base}/en` } } },
    { url: `${base}/en`, changeFrequency: 'weekly', priority: 0.5, alternates: { languages: { zh: `${base}/`, en: `${base}/en` } } },

    { url: `${base}/about`, changeFrequency: 'yearly', priority: 0.3, alternates: { languages: { zh: `${base}/about`, en: `${base}/en/about` } } },
    { url: `${base}/anime`, changeFrequency: 'weekly', priority: 0.5, alternates: { languages: { zh: `${base}/anime`, en: `${base}/en/anime` } } },
    { url: `${base}/en/anime`, changeFrequency: 'weekly', priority: 0.3, alternates: { languages: { zh: `${base}/anime`, en: `${base}/en/anime` } } },

    { url: `${base}/city`, changeFrequency: 'weekly', priority: 0.5, alternates: { languages: { zh: `${base}/city`, en: `${base}/en/city` } } },
    { url: `${base}/en/city`, changeFrequency: 'weekly', priority: 0.3, alternates: { languages: { zh: `${base}/city`, en: `${base}/en/city` } } },

    { url: `${base}/resources`, changeFrequency: 'monthly', priority: 0.6, alternates: { languages: { zh: `${base}/resources`, en: `${base}/en/resources` } } },
    { url: `${base}/en/resources`, changeFrequency: 'monthly', priority: 0.4, alternates: { languages: { zh: `${base}/resources`, en: `${base}/en/resources` } } },
  ]
  for (const a of anime) {
    const id = String(a?.id || '').trim()
    if (!id) continue

    const zhUrl = `${base}/anime/${encodeURIComponent(id)}`
    const enUrl = `${base}/en/anime/${encodeURIComponent(id)}`

    items.push({
      url: zhUrl,
      changeFrequency: 'weekly',
      priority: 0.6,
      alternates: { languages: { zh: zhUrl, en: enUrl } },
    })

    items.push({
      url: enUrl,
      changeFrequency: 'weekly',
      priority: 0.2,
      alternates: { languages: { zh: zhUrl, en: enUrl } },
    })
  }

  for (const c of cities) {
    const slug = String((c as any)?.slug || '').trim()
    if (!slug) continue

    const zhUrl = `${base}/city/${encodeURIComponent(slug)}`
    const enUrl = `${base}/en/city/${encodeURIComponent(slug)}`

    items.push({
      url: zhUrl,
      changeFrequency: 'weekly',
      priority: 0.6,
      alternates: { languages: { zh: zhUrl, en: enUrl } },
    })

    items.push({
      url: enUrl,
      changeFrequency: 'weekly',
      priority: 0.2,
      alternates: { languages: { zh: zhUrl, en: enUrl } },
    })
  }

  for (const r of resources) {
    const id = String(r?.id || '').trim()
    if (!id) continue

    const zhUrl = `${base}/resources/${encodeURIComponent(id)}`
    const enUrl = `${base}/en/resources/${encodeURIComponent(id)}`

    items.push({
      url: zhUrl,
      changeFrequency: 'monthly',
      priority: 0.7,
      alternates: { languages: { zh: zhUrl, en: enUrl } },
    })

    items.push({
      url: enUrl,
      changeFrequency: 'monthly',
      priority: 0.3,
      alternates: { languages: { zh: zhUrl, en: enUrl } },
    })
  }

  for (const p of posts) {
    const zhUrl = `${base}${p.path}`

    items.push({
      url: zhUrl,
      lastModified: toLastModified(p.updatedAt || p.publishedAt || p.publishDate),
      changeFrequency: 'monthly',
      priority: 0.7,
    })
  }
  return items
}
