import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import TranslationDetailUI from '@/app/(authed)/admin/translations/[id]/ui'

// Mock dependencies
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/admin/translations/123',
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('next/link', () => ({
  default: ({ children, href, className }: any) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}))

// Mock components
vi.mock('@/components/translation/TipTapPreview', () => ({
  default: ({ content }: any) => <div data-testid="tiptap-preview">{JSON.stringify(content)}</div>,
}))

vi.mock('@/components/toc/ArticleToc', () => ({
  default: () => <div data-testid="article-toc">Article TOC</div>,
}))

vi.mock('@/components/blog/PostMeta', () => ({
  default: () => <div data-testid="post-meta">Post Meta</div>,
}))

vi.mock('@/components/layout/Breadcrumbs', () => ({
  default: () => <div data-testid="breadcrumbs">Breadcrumbs</div>,
}))

describe('TranslationDetailUI Layout', () => {
  const mockTask = {
    id: 't1',
    entityType: 'article',
    entityId: 'a1',
    targetLanguage: 'ja',
    status: 'ready',
    sourceContent: { type: 'doc', content: [] },
    draftContent: { 
      type: 'doc', 
      title: 'Test Article',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Translated content' }] }] 
    },
    createdAt: '2023-01-01T00:00:00Z',
  }

  beforeEach(() => {
    vi.resetAllMocks()
    global.fetch = vi.fn((url: string) => {
      if (url.includes('/api/admin/translations/123')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ task: mockTask }),
        })
      }
      return Promise.reject(new Error('Not found'))
    }) as any
  })

  it('renders with new single-column layout structure', async () => {
    render(<TranslationDetailUI id="123" />)

    // Wait for data load
    await waitFor(() => {
      expect(screen.queryByText('加载中...')).not.toBeInTheDocument()
    })

    // Assert: No "Source Content" section (as per requirements)
    expect(screen.queryByText('源内容 (中文)')).not.toBeInTheDocument()

    // Assert: Sidebar components exist
    expect(screen.getByTestId('article-toc')).toBeInTheDocument()

    // Assert: Main content components exist
    expect(screen.getByTestId('breadcrumbs')).toBeInTheDocument()
    expect(screen.getByTestId('post-meta')).toBeInTheDocument()
    expect(screen.getByTestId('tiptap-preview')).toBeInTheDocument()

    // Assert: Layout classes (prose-pink)
    const article = document.querySelector('article')
    expect(article).toHaveClass('prose', 'prose-pink')
    expect(article).toHaveAttribute('data-seichi-article-content', 'true')
  })
})
