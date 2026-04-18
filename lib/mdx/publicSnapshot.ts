import postsEn from '@/content/generated/public-posts-en.json'
import postsJa from '@/content/generated/public-posts-ja.json'
import postsZh from '@/content/generated/public-posts-zh.json'
import type { Post, PostFrontmatter } from './types'

type SnapshotPostRecord = {
  frontmatter: PostFrontmatter
  contentHtml: string
}

function cloneFrontmatter(frontmatter: PostFrontmatter): PostFrontmatter {
  return {
    ...frontmatter,
    areas: frontmatter.areas ? [...frontmatter.areas] : undefined,
    tags: frontmatter.tags ? [...frontmatter.tags] : [],
    photoTips: frontmatter.photoTips ? [...frontmatter.photoTips] : undefined,
    tldr: frontmatter.tldr ? { ...frontmatter.tldr } : undefined,
    transportation: frontmatter.transportation
      ? {
          ...frontmatter.transportation,
          lines: frontmatter.transportation.lines ? [...frontmatter.transportation.lines] : undefined,
          tips: frontmatter.transportation.tips ? [...frontmatter.transportation.tips] : undefined,
        }
      : undefined,
  }
}

function getRecords(language: string): SnapshotPostRecord[] {
  switch (language) {
    case 'en':
      return postsEn as SnapshotPostRecord[]
    case 'ja':
      return postsJa as SnapshotPostRecord[]
    case 'zh':
    default:
      return postsZh as SnapshotPostRecord[]
  }
}

export async function getSnapshotPostFrontmatters(language: string = 'zh'): Promise<PostFrontmatter[]> {
  return getRecords(language).map((record) => cloneFrontmatter(record.frontmatter))
}

export async function getSnapshotPostBySlug(slug: string, language: string = 'zh'): Promise<Post | null> {
  const key = String(slug || '').trim()
  if (!key) return null

  const found = getRecords(language).find((record) => record.frontmatter.slug === key)
  if (!found) return null

  return {
    frontmatter: cloneFrontmatter(found.frontmatter),
    content: null,
    contentHtml: found.contentHtml,
  }
}
