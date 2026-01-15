import type { MetadataRoute } from 'next'
import { getAllPublicPosts } from '@/lib/posts/getAllPublicPosts'
import { getAllAnime } from '@/lib/anime/getAllAnime'
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
  const items: MetadataRoute.Sitemap = [
    { url: `${base}/`, changeFrequency: 'weekly', priority: 0.8 },
    { url: `${base}/about`, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${base}/anime`, changeFrequency: 'weekly', priority: 0.5 },
  ]
  for (const a of anime) {
    const id = String(a?.id || '').trim()
    if (!id) continue
    items.push({ url: `${base}/anime/${encodeURIComponent(id)}`, changeFrequency: 'weekly', priority: 0.6 })
  }
  for (const p of posts) {
    items.push({
      url: `${base}${p.path}`,
      lastModified: toLastModified(p.updatedAt || p.publishedAt || p.publishDate),
      changeFrequency: 'monthly',
      priority: 0.7,
    })
  }
  return items
}
