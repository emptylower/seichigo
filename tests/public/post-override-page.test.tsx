import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('next/navigation', () => ({
  notFound: () => <div>文章不存在或已下架</div>,
  permanentRedirect: (url: string) => {
    throw new Error(`redirect:${url}`)
  },
}))

const resolvePublicOverrideForPostMock = vi.fn()
vi.mock('@/lib/publicOverride/service', () => ({
  resolvePublicOverrideForPost: (...args: any[]) => resolvePublicOverrideForPostMock(...args),
}))

const getPublicPostBySlugMock = vi.fn()
vi.mock('@/lib/posts/getPublicPostBySlug', () => ({
  getPublicPostBySlug: (...args: any[]) => getPublicPostBySlugMock(...args),
}))

vi.mock('@/lib/posts/getDbArticleForPublicNotice', () => ({
  getDbArticleForPublicNotice: vi.fn().mockResolvedValue(null),
}))

describe('public post page emergency override', () => {
  it('renders emergency copy without loading the original post', async () => {
    resolvePublicOverrideForPostMock.mockResolvedValueOnce({
      action: 'replace-with-emergency-copy',
      title: '紧急说明',
      bodyText: '原内容已临时替换。',
      ctaLabel: '查看详情',
      ctaHref: '/notice',
    })

    const PostPage = (await import('@/app/(site)/posts/[slug]/page')).default
    render(await PostPage({ params: Promise.resolve({ slug: 'test-post' }) }))

    expect(screen.getByText('紧急说明')).toBeInTheDocument()
    expect(screen.getByText('原内容已临时替换。')).toBeInTheDocument()
    expect(getPublicPostBySlugMock).not.toHaveBeenCalled()
  })

  it('redirects immediately when override action is redirect', async () => {
    resolvePublicOverrideForPostMock.mockResolvedValueOnce({
      action: 'redirect',
      redirectUrl: '/legal/notice',
    })

    const PostPage = (await import('@/app/(site)/posts/[slug]/page')).default
    await expect(PostPage({ params: Promise.resolve({ slug: 'test-post' }) })).rejects.toThrow('redirect:/legal/notice')
  })
})
