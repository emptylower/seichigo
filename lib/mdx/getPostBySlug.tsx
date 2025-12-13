import fs from 'node:fs/promises'
import path from 'node:path'
import matter from 'gray-matter'
import { compileMDX } from 'next-mdx-remote/rsc'
import type { Post } from './types'
import { mdxComponents } from './mdxComponents'

const CONTENT_ROOT = path.join(process.cwd(), 'content')

export async function getPostBySlug(slug: string, language: string = 'zh'): Promise<Post | null> {
  const postsDir = path.join(CONTENT_ROOT, language, 'posts')
  const files = await fs.readdir(postsDir).catch(() => [])
  const filename = files.find((f) => f.endsWith('.mdx') && f.replace(/\.mdx$/, '') === slug)
  if (!filename) {
    // Try match by frontmatter
    for (const f of files.filter((x) => x.endsWith('.mdx'))) {
      const raw = await fs.readFile(path.join(postsDir, f), 'utf-8')
      const { data } = matter(raw)
      if ((data as any)?.slug === slug) {
        const compiled = await compileMDX<{ [key: string]: any }>({
          source: raw,
          options: { parseFrontmatter: true },
          components: mdxComponents,
        })
        return {
          frontmatter: compiled.frontmatter as any,
          content: compiled.content,
        }
      }
    }
    return null
  }
  const full = path.join(postsDir, filename)
  const source = await fs.readFile(full, 'utf-8')
  const compiled = await compileMDX<{ [key: string]: any }>({
    source,
    options: { parseFrontmatter: true },
    components: mdxComponents,
  })
  return {
    frontmatter: compiled.frontmatter as any,
    content: compiled.content,
  }
}

