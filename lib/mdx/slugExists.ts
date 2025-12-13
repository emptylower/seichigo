import fs from 'node:fs/promises'
import path from 'node:path'
import matter from 'gray-matter'

const CONTENT_ROOT = path.join(process.cwd(), 'content')

export async function mdxSlugExists(slug: string, language: string = 'zh'): Promise<boolean> {
  const target = slug.trim()
  if (!target) return false

  const postsDir = path.join(CONTENT_ROOT, language, 'posts')
  const files = await fs.readdir(postsDir).catch(() => [])
  for (const file of files.filter((f) => f.endsWith('.mdx'))) {
    const basename = file.replace(/\.mdx$/, '')
    if (basename === target) return true

    const raw = await fs.readFile(path.join(postsDir, file), 'utf-8').catch(() => null)
    if (!raw) continue

    const { data } = matter(raw)
    if (String((data as any)?.slug || '') === target) return true
  }
  return false
}

