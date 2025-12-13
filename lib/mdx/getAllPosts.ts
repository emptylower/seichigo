import fs from 'node:fs/promises'
import path from 'node:path'
import matter from 'gray-matter'
import type { PostFrontmatter } from './types'

const CONTENT_ROOT = path.join(process.cwd(), 'content')

export async function getAllPosts(language: string = 'zh'): Promise<PostFrontmatter[]> {
  const postsDir = path.join(CONTENT_ROOT, language, 'posts')
  let files: string[] = []
  try {
    files = await fs.readdir(postsDir)
  } catch {
    return []
  }
  const mdxFiles = files.filter((f) => f.endsWith('.mdx'))
  const posts: PostFrontmatter[] = []
  for (const file of mdxFiles) {
    const full = path.join(postsDir, file)
    const raw = await fs.readFile(full, 'utf-8')
    const { data } = matter(raw)
    const fm = data as Partial<PostFrontmatter>
    if (!fm.title || !fm.slug || fm.status === 'draft') continue
    posts.push({
      title: fm.title,
      slug: fm.slug!,
      animeId: fm.animeId || 'unknown',
      city: fm.city || '',
      routeLength: fm.routeLength,
      language: fm.language || language,
      tags: fm.tags || [],
      publishDate: fm.publishDate,
      updatedDate: fm.updatedDate,
      status: (fm.status as any) || 'published',
    })
  }
  // Newest first by publishDate if present
  return posts.sort((a, b) => (b.publishDate || '').localeCompare(a.publishDate || ''))
}

