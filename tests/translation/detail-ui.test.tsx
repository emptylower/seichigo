import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import TranslationDetailUI from '../../app/(authed)/admin/translations/[id]/ui'
import React from 'react'

// Mock TipTapPreview component
vi.mock('@/components/translation/TipTapPreview', () => ({
  default: ({ content, mode }: any) => (
    <div data-testid={`tiptap-preview-${mode}`}>
      {content ? JSON.stringify(content) : 'no-content'}
    </div>
  )
}))

// Mock fetch
const mockFetch = vi.fn()
global.fetch = mockFetch

// Mock useRouter
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
}))

describe('TranslationDetailUI', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders loading state initially', () => {
    mockFetch.mockReturnValue(new Promise(() => {})) // Never resolves
    render(<TranslationDetailUI id="123" />)
    expect(screen.getByText('加载中...')).toBeDefined()
  })

  it('renders task details with TipTap content correctly', async () => {
    const mockTask = {
      id: '123',
      entityType: 'article',
      entityId: '456',
      targetLanguage: 'en',
      status: 'pending',
      sourceContent: { type: 'doc', content: [{ type: 'paragraph' }] },
      draftContent: { type: 'doc', content: [{ type: 'paragraph' }] },
      createdAt: new Date().toISOString(),
    }

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ task: mockTask }),
    })

    render(<TranslationDetailUI id="123" />)

    await waitFor(() => {
      expect(screen.getByText('翻译详情')).toBeDefined()
    })

    // Check status badges
    expect(screen.getByText('文章')).toBeDefined()
    expect(screen.getByText('English')).toBeDefined()
    expect(screen.getByText('pending')).toBeDefined()

    // Check if TipTapPreview is used for both source and draft
    const previews = screen.getAllByTestId('tiptap-preview-preview')
    expect(previews).toHaveLength(2)
    
    // Check content passed to mock
    expect(previews[0].textContent).toContain('paragraph')
    expect(previews[1].textContent).toContain('paragraph')
  })

  it('renders task details with non-TipTap content as text', async () => {
    const mockTask = {
      id: '123',
      entityType: 'city',
      entityId: 'tokyo',
      targetLanguage: 'en',
      status: 'pending',
      sourceContent: { name: '东京' }, // Not a doc
      draftContent: null,
      createdAt: new Date().toISOString(),
    }

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ task: mockTask }),
    })

    render(<TranslationDetailUI id="123" />)

    await waitFor(() => {
      expect(screen.getByText('翻译详情')).toBeDefined()
    })

    // Should NOT find TipTapPreview
    expect(screen.queryByTestId('tiptap-preview-preview')).toBeNull()

    // Should find JSON stringified content
    const preTags = document.querySelectorAll('pre')
    expect(preTags.length).toBeGreaterThan(0)
    expect(preTags[0].textContent).toContain('东京')
  })

  it('renders error message if task has error', async () => {
    const mockTask = {
      id: '123',
      entityType: 'article',
      entityId: '456',
      targetLanguage: 'en',
      status: 'error',
      sourceContent: {},
      draftContent: null,
      error: 'Something went wrong',
      createdAt: new Date().toISOString(),
    }

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ task: mockTask }),
    })

    render(<TranslationDetailUI id="123" />)

    await waitFor(() => {
      expect(screen.getByText(/Something went wrong/)).toBeDefined()
    })
  })
})
