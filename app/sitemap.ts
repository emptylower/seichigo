import type { MetadataRoute } from 'next'
import { getAllPublicPosts } from '@/lib/posts/getAllPublicPosts'

export const runtime = 'nodejs'
export const revalidate = 0

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = (process.env.SITE_URL || 'http://localhost:3000').replace(/\/$/, '')
  const posts = await getAllPublicPosts('zh')
  const items: MetadataRoute.Sitemap = [
    { url: `${base}/`, changeFrequency: 'weekly', priority: 0.8 },
    { url: `${base}/about`, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${base}/anime`, changeFrequency: 'weekly', priority: 0.5 },
  ]
  for (const p of posts) {
    items.push({ url: `${base}${p.path}`, changeFrequency: 'monthly', priority: 0.7 })
  }
  return items
}
