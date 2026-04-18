import { describe, expect, it } from 'vitest'
import { getSnapshotPostBySlug, getSnapshotPostFrontmatters } from '@/lib/mdx/publicSnapshot'

describe('public mdx snapshot', () => {
  it('lists bundled frontmatter for zh public posts', async () => {
    const posts = await getSnapshotPostFrontmatters('zh')

    expect(posts.length).toBeGreaterThan(0)
    expect(posts.some((post) => post.slug === '2-sound-euphonium')).toBe(true)
  })

  it('returns bundled html for a known zh public post', async () => {
    const post = await getSnapshotPostBySlug('2-sound-euphonium', 'zh')

    expect(post?.frontmatter.slug).toBe('2-sound-euphonium')
    expect(post?.contentHtml).toContain('吹响吧！上低音号')
  })
})
