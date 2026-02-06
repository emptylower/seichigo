const SEO_SPOKE_TAG = 'seo-spoke'

function normalizeTag(tag: unknown): string {
  return String(tag ?? '').trim().toLowerCase()
}

export function hasSeoSpokeTag(tags: unknown): boolean {
  if (!Array.isArray(tags)) return false
  return tags.some((tag) => normalizeTag(tag) === SEO_SPOKE_TAG)
}

export function isSeoSpokePost(post: { tags?: unknown } | null | undefined): boolean {
  if (!post) return false
  return hasSeoSpokeTag(post.tags)
}

export function splitSeoSpokePosts<T extends { tags?: unknown }>(posts: T[]): { regular: T[]; seoSpoke: T[] } {
  const regular: T[] = []
  const seoSpoke: T[] = []
  for (const post of posts) {
    if (isSeoSpokePost(post)) {
      seoSpoke.push(post)
      continue
    }
    regular.push(post)
  }
  return { regular, seoSpoke }
}
