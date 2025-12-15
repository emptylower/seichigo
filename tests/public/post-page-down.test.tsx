import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

const getPublicPostBySlugMock = vi.fn()
vi.mock('@/lib/posts/getPublicPostBySlug', () => ({
  getPublicPostBySlug: (...args: any[]) => getPublicPostBySlugMock(...args),
}))

const getDbArticleForPublicNoticeMock = vi.fn()
vi.mock('@/lib/posts/getDbArticleForPublicNotice', () => ({
  getDbArticleForPublicNotice: (...args: any[]) => getDbArticleForPublicNoticeMock(...args),
}))

describe('public post page (down notice)', () => {
  it('shows “已下架” when DB article exists but is not published', async () => {
    getPublicPostBySlugMock.mockResolvedValueOnce(null)
    getDbArticleForPublicNoticeMock.mockResolvedValueOnce({
      id: 'a1',
      status: 'rejected',
      publishedAt: new Date('2025-01-02T00:00:00.000Z'),
    })

    const PostPage = (await import('@/app/(site)/posts/[slug]/page')).default
    render(await PostPage({ params: Promise.resolve({ slug: 'a1-hello' }) }))

    expect(screen.getByText('文章已下架。')).toBeInTheDocument()
  })

  it('shows “未找到” when post is missing', async () => {
    getPublicPostBySlugMock.mockResolvedValueOnce(null)
    getDbArticleForPublicNoticeMock.mockResolvedValueOnce(null)

    const PostPage = (await import('@/app/(site)/posts/[slug]/page')).default
    render(await PostPage({ params: Promise.resolve({ slug: 'missing' }) }))

    expect(screen.getByText('文章未找到。')).toBeInTheDocument()
  })
})

