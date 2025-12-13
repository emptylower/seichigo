import type { MetadataRoute } from 'next'
import { getAllPosts } from '@/lib/mdx/getAllPosts'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = process.env.SITE_URL || 'http://localhost:3000'
  const posts = await getAllPosts('zh')
  const items: MetadataRoute.Sitemap = [
    { url: `${base}/`, changeFrequency: 'weekly', priority: 0.8 },
    { url: `${base}/about`, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${base}/anime`, changeFrequency: 'weekly', priority: 0.5 },
  ]
  for (const p of posts) {
    items.push({ url: `${base}/posts/${p.slug}`, changeFrequency: 'monthly', priority: 0.7 })
  }
  return items
}

