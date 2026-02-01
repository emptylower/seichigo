import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import TranslationDetailUI from '../../app/(authed)/admin/translations/[id]/ui'
import React from 'react'

vi.mock('@/components/translation/TipTapPreview', () => ({
  default: ({ content, mode, onChange }: any) => (
    <div data-testid={`tiptap-preview-${mode}`}>
      <div data-testid="content-display">{JSON.stringify(content)}</div>
      {mode === 'edit' && (
        <button 
          data-testid="simulate-change"
          onClick={() => onChange({ type: 'doc', content: [{ type: 'paragraph', text: 'edited' }] })}
        >
          Simulate Change
        </button>
      )}
    </div>
  )
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
  usePathname: () => '/admin/translations/123',
}))

vi.mock('@/components/toc/ArticleToc', () => ({
  default: () => <div>TOC</div>,
}))

vi.mock('@/components/blog/PostMeta', () => ({
  default: () => <div>Meta</div>,
}))

vi.mock('@/components/layout/Breadcrumbs', () => ({
  default: () => <div>Breadcrumbs</div>,
}))

vi.mock('../../../../../hooks/useTranslationAutoSave', () => ({
  useTranslationAutoSave: () => ({ saveState: 'saved', saveError: null }),
}))

const mockFetch = vi.fn()
global.fetch = mockFetch

describe('TranslationDetailUI Edit Mode with Auto-Save', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.confirm = vi.fn().mockReturnValue(true)
  })

  const mockTask = {
    id: '123',
    entityType: 'article',
    entityId: '456',
    targetLanguage: 'en',
    status: 'ready',
    sourceContent: { type: 'doc', content: [{ type: 'paragraph', text: 'source' }] },
    draftContent: { type: 'doc', content: [{ type: 'paragraph', text: 'original' }] },
    createdAt: new Date().toISOString(),
  }

  it('allows entering edit mode and editing content with auto-save', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ task: mockTask }),
    })

    render(<TranslationDetailUI id="123" />)

    await waitFor(() => {
      expect(screen.getByText('翻译详情')).toBeDefined()
    })

    const editBtn = screen.getByText('编辑翻译')
    expect(editBtn).toBeDefined()

    fireEvent.click(editBtn)
    
    await waitFor(() => {
      expect(screen.getByTestId('tiptap-preview-edit')).toBeDefined()
    })

    expect(screen.getByText('重新翻译全文')).toBeDefined()
    expect(screen.getByText('确认翻译')).toBeDefined()

    fireEvent.click(screen.getByTestId('simulate-change'))

    await waitFor(() => {
      const display = screen.getByTestId('content-display')
      expect(display.textContent).toContain('edited')
    })
  })

  it('renders edit mode with correct buttons', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ task: mockTask }),
    })

    render(<TranslationDetailUI id="123" />)

    await waitFor(() => {
      expect(screen.getByText('翻译详情')).toBeDefined()
    })

    fireEvent.click(screen.getByText('编辑翻译'))

    await waitFor(() => {
      expect(screen.getByTestId('tiptap-preview-edit')).toBeDefined()
    })

    expect(screen.getByText('重新翻译全文')).toBeDefined()
    expect(screen.getByText('确认翻译')).toBeDefined()
  })
})
