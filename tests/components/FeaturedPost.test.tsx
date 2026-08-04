import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { PublicPostListItem } from '@/lib/posts/types'
import FeaturedPost from '@/components/bookstore/FeaturedPost'

vi.mock('@/components/bookstore/BookCover', () => ({
  default: function MockBookCover() {
    return <div data-testid="book-cover" />
  },
}))

function makeItem(overrides: Partial<PublicPostListItem> = {}): PublicPostListItem {
  return {
    source: 'mdx',
    path: '/en/posts/example',
    title: 'English post',
    animeIds: [],
    city: '',
    tags: [],
    ...overrides,
  }
}

describe('FeaturedPost localized tags', () => {
  it('renders localized Japanese tags instead of the source labels', () => {
    render(
      <FeaturedPost
        item={makeItem({
          tags: ['你的名字', '东京'],
          localizedTags: ['君の名は。', '東京'],
        })}
        locale="ja"
      />
    )

    expect(screen.getByText('君の名は。')).toBeInTheDocument()
    expect(screen.getByText('東京')).toBeInTheDocument()
    expect(screen.queryByText('你的名字')).not.toBeInTheDocument()
    expect(screen.queryByText('东京')).not.toBeInTheDocument()
  })

  it('falls back to source tags when localized display data is missing', () => {
    render(
      <FeaturedPost
        item={makeItem({ tags: ['untranslated tag'], localizedTags: [] })}
        locale="en"
      />
    )

    expect(screen.getByText('untranslated tag')).toBeInTheDocument()
  })
})
