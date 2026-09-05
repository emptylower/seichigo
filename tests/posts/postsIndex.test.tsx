import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import PostsIndexTemplate from '@/components/posts/PostsIndexTemplate'
import type { PublicPostListItem } from '@/lib/posts/types'

function makeItem(slug: string, title: string): PublicPostListItem {
  return {
    source: 'mdx',
    path: `/posts/${slug}`,
    title,
    animeIds: ['your-name'],
    city: '飞驒市',
    tags: [],
    cover: null,
    publishDate: '2026-01-01',
  }
}

describe('PostsIndexTemplate', () => {
  it('列出传入的攻略并链接到详情页', () => {
    render(
      <PostsIndexTemplate
        locale="zh"
        items={[makeItem('a', '你的名字巡礼'), makeItem('b', '孤独摇滚下北泽')]}
      />
    )

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('巡礼攻略')
    expect(screen.getByRole('link', { name: /你的名字巡礼/ })).toHaveAttribute('href', '/posts/a')
    expect(screen.getByRole('link', { name: /孤独摇滚下北泽/ })).toHaveAttribute('href', '/posts/b')
  })

  it('空列表时给出占位文案而不是空白页', () => {
    render(<PostsIndexTemplate locale="zh" items={[]} />)

    expect(screen.queryAllByRole('link')).toHaveLength(0)
    expect(screen.getByText('还没有已发布的攻略，先去地图或规划师那边逛逛吧。')).toBeInTheDocument()
  })

  it('英文与日文标题走 i18n 而不是写死中文', () => {
    const { unmount } = render(<PostsIndexTemplate locale="en" items={[]} />)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Pilgrimage guides')
    unmount()

    render(<PostsIndexTemplate locale="ja" items={[]} />)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('巡礼ガイド')
  })
})
