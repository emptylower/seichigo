import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('next/navigation', () => ({
  notFound: () => <div>文章不存在或已下架</div>,
  permanentRedirect: () => {
    throw new Error('redirect')
  },
}))

const getPublicPostBySlugMock = vi.fn()
vi.mock('@/lib/posts/getPublicPostBySlug', () => ({
  getPublicPostBySlug: (...args: any[]) => getPublicPostBySlugMock(...args),
}))

const getDbArticleForPublicNoticeMock = vi.fn()
vi.mock('@/lib/posts/getDbArticleForPublicNotice', () => ({
  getDbArticleForPublicNotice: (...args: any[]) => getDbArticleForPublicNoticeMock(...args),
}))

describe('public post page (down notice)', () => {
  it('uses notFound when DB article exists but is not published', async () => {
    getPublicPostBySlugMock.mockResolvedValueOnce(null)
    getDbArticleForPublicNoticeMock.mockResolvedValueOnce({
      id: 'a1',
      status: 'rejected',
      publishedAt: new Date('2025-01-02T00:00:00.000Z'),
    })

    const PostPage = (await import('@/app/(site)/posts/[slug]/page')).default
    render(await PostPage({ params: Promise.resolve({ slug: 'a1-hello' }) }))

    expect(screen.getByText('文章不存在或已下架')).toBeInTheDocument()
  })

  it('uses notFound when post is missing', async () => {
    getPublicPostBySlugMock.mockResolvedValueOnce(null)
    getDbArticleForPublicNoticeMock.mockResolvedValueOnce(null)

    const PostPage = (await import('@/app/(site)/posts/[slug]/page')).default
    render(await PostPage({ params: Promise.resolve({ slug: 'missing' }) }))

    expect(screen.getByText('文章不存在或已下架')).toBeInTheDocument()
  })
})
