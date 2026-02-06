import type { MetadataRoute } from 'next'
import { getAllPublicPosts } from '@/lib/posts/getAllPublicPosts'
import { getAllAnime } from '@/lib/anime/getAllAnime'
import { listCitiesForIndex } from '@/lib/city/db'
import { getAllLinkAssets } from '@/lib/linkAsset/getAllLinkAssets'
import { getSiteOrigin } from '@/lib/seo/site'

export const runtime = 'nodejs'
export const revalidate = 3600

function toLastModified(input?: string): Date | undefined {
  const raw = typeof input === 'string' ? input.trim() : ''
  if (!raw) return undefined
  const dt = new Date(raw)
  if (!Number.isFinite(dt.getTime())) return undefined
  return dt
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = getSiteOrigin()
  const [postsZh, postsEn, postsJa, anime, cities, resources] = await Promise.all([
    getAllPublicPosts('zh').catch(() => []),
    getAllPublicPosts('en').catch(() => []),
    getAllPublicPosts('ja').catch(() => []),
    getAllAnime().catch(() => []),
    listCitiesForIndex().catch(() => []),
    getAllLinkAssets().catch(() => []),
  ])
  const postsByPath = new Map<string, (typeof postsZh)[number]>()
  for (const post of [...postsZh, ...postsEn, ...postsJa]) {
    if (!post?.path) continue
    if (postsByPath.has(post.path)) continue
    postsByPath.set(post.path, post)
  }
  const posts = Array.from(postsByPath.values())

  const now = new Date()

  const items: MetadataRoute.Sitemap = [
    { url: `${base}/`, lastModified: now, changeFrequency: 'weekly', priority: 0.8, alternates: { languages: { zh: `${base}/`, en: `${base}/en`, ja: `${base}/ja` } } },
    { url: `${base}/en`, lastModified: now, changeFrequency: 'weekly', priority: 0.5, alternates: { languages: { zh: `${base}/`, en: `${base}/en`, ja: `${base}/ja` } } },
    { url: `${base}/ja`, lastModified: now, changeFrequency: 'weekly', priority: 0.5, alternates: { languages: { zh: `${base}/`, en: `${base}/en`, ja: `${base}/ja` } } },

    { url: `${base}/about`, lastModified: now, changeFrequency: 'yearly', priority: 0.3, alternates: { languages: { zh: `${base}/about`, en: `${base}/en/about`, ja: `${base}/ja/about` } } },
    { url: `${base}/anime`, lastModified: now, changeFrequency: 'weekly', priority: 0.5, alternates: { languages: { zh: `${base}/anime`, en: `${base}/en/anime`, ja: `${base}/ja/anime` } } },
    { url: `${base}/en/anime`, lastModified: now, changeFrequency: 'weekly', priority: 0.3, alternates: { languages: { zh: `${base}/anime`, en: `${base}/en/anime`, ja: `${base}/ja/anime` } } },
    { url: `${base}/ja/anime`, lastModified: now, changeFrequency: 'weekly', priority: 0.3, alternates: { languages: { zh: `${base}/anime`, en: `${base}/en/anime`, ja: `${base}/ja/anime` } } },

    { url: `${base}/city`, lastModified: now, changeFrequency: 'weekly', priority: 0.5, alternates: { languages: { zh: `${base}/city`, en: `${base}/en/city`, ja: `${base}/ja/city` } } },
    { url: `${base}/en/city`, lastModified: now, changeFrequency: 'weekly', priority: 0.3, alternates: { languages: { zh: `${base}/city`, en: `${base}/en/city`, ja: `${base}/ja/city` } } },
    { url: `${base}/ja/city`, lastModified: now, changeFrequency: 'weekly', priority: 0.3, alternates: { languages: { zh: `${base}/city`, en: `${base}/en/city`, ja: `${base}/ja/city` } } },

    { url: `${base}/resources`, lastModified: now, changeFrequency: 'monthly', priority: 0.6, alternates: { languages: { zh: `${base}/resources`, en: `${base}/en/resources`, ja: `${base}/ja/resources` } } },
    { url: `${base}/en/resources`, lastModified: now, changeFrequency: 'monthly', priority: 0.4, alternates: { languages: { zh: `${base}/resources`, en: `${base}/en/resources`, ja: `${base}/ja/resources` } } },
    { url: `${base}/ja/resources`, lastModified: now, changeFrequency: 'monthly', priority: 0.4, alternates: { languages: { zh: `${base}/resources`, en: `${base}/en/resources`, ja: `${base}/ja/resources` } } },
  ]
  for (const a of anime) {
    const id = String(a?.id || '').trim()
    if (!id) continue

    const zhUrl = `${base}/anime/${encodeURIComponent(id)}`
    const enUrl = `${base}/en/anime/${encodeURIComponent(id)}`
    const jaUrl = `${base}/ja/anime/${encodeURIComponent(id)}`

    items.push({
      url: zhUrl,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.6,
      alternates: { languages: { zh: zhUrl, en: enUrl, ja: jaUrl } },
    })

    items.push({
      url: enUrl,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.2,
      alternates: { languages: { zh: zhUrl, en: enUrl, ja: jaUrl } },
    })

    items.push({
      url: jaUrl,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.2,
      alternates: { languages: { zh: zhUrl, en: enUrl, ja: jaUrl } },
    })
  }

  for (const c of cities) {
    const slug = String((c as any)?.slug || '').trim()
    if (!slug) continue

    const zhUrl = `${base}/city/${encodeURIComponent(slug)}`
    const enUrl = `${base}/en/city/${encodeURIComponent(slug)}`
    const jaUrl = `${base}/ja/city/${encodeURIComponent(slug)}`

    items.push({
      url: zhUrl,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.6,
      alternates: { languages: { zh: zhUrl, en: enUrl, ja: jaUrl } },
    })

    items.push({
      url: enUrl,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.2,
      alternates: { languages: { zh: zhUrl, en: enUrl, ja: jaUrl } },
    })

    items.push({
      url: jaUrl,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.2,
      alternates: { languages: { zh: zhUrl, en: enUrl, ja: jaUrl } },
    })
  }

  for (const r of resources) {
    const id = String(r?.id || '').trim()
    if (!id) continue

    const zhUrl = `${base}/resources/${encodeURIComponent(id)}`
    const enUrl = `${base}/en/resources/${encodeURIComponent(id)}`
    const jaUrl = `${base}/ja/resources/${encodeURIComponent(id)}`

    items.push({
      url: zhUrl,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.7,
      alternates: { languages: { zh: zhUrl, en: enUrl, ja: jaUrl } },
    })

    items.push({
      url: enUrl,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.3,
      alternates: { languages: { zh: zhUrl, en: enUrl, ja: jaUrl } },
    })

    items.push({
      url: jaUrl,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.3,
      alternates: { languages: { zh: zhUrl, en: enUrl, ja: jaUrl } },
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
