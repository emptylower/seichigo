import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import TranslationDetailUI from '../../app/(authed)/admin/translations/[id]/ui'
import React from 'react'

// Mock TipTapPreview component
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

// Mock fetch
const mockFetch = vi.fn()
global.fetch = mockFetch

// Mock useRouter
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
}))

describe('TranslationDetailUI Edit Mode', () => {
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

  it('allows entering edit mode, saving changes, and persisting to API', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ task: mockTask }),
    })

    render(<TranslationDetailUI id="123" />)

    await waitFor(() => {
      expect(screen.getByText('翻译详情')).toBeDefined()
    })

    // 1. Check for Edit button
    const editBtn = screen.getByText('编辑翻译')
    expect(editBtn).toBeDefined()

    // 2. Enter edit mode
    fireEvent.click(editBtn)
    
    // Check if TipTapPreview is in edit mode
    expect(screen.getByTestId('tiptap-preview-edit')).toBeDefined()
    
    // Check for Save/Cancel buttons
    expect(screen.getByText('保存')).toBeDefined()
    expect(screen.getByText('取消')).toBeDefined()

    // 3. Simulate content change
    fireEvent.click(screen.getByTestId('simulate-change'))

    // 4. Save changes
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, task: { ...mockTask, draftContent: { type: 'doc', content: [{ type: 'paragraph', text: 'edited' }] } } }),
    })

    fireEvent.click(screen.getByText('保存'))

    // Check API call
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/admin/translations/123', expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({
          draftContent: { type: 'doc', content: [{ type: 'paragraph', text: 'edited' }] }
        })
      }))
    })

    // 5. Verify exit edit mode and content updated (in UI state)
    await waitFor(() => {
        expect(screen.queryByTestId('tiptap-preview-edit')).toBeNull()
        const previews = screen.getAllByTestId('tiptap-preview-preview')
        expect(previews).toHaveLength(2)
        expect(previews[1].textContent).toContain('edited')
    })
  })

  it('cancels editing and reverts changes', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ task: mockTask }),
    })

    render(<TranslationDetailUI id="123" />)

    await waitFor(() => {
      expect(screen.getByText('翻译详情')).toBeDefined()
    })

    // Enter edit mode
    fireEvent.click(screen.getByText('编辑翻译'))

    // Simulate content change
    fireEvent.click(screen.getByTestId('simulate-change'))

    // Click Cancel
    fireEvent.click(screen.getByText('取消'))

    // Verify exit edit mode
    expect(screen.queryByTestId('tiptap-preview-edit')).toBeNull()
    const previews = screen.getAllByTestId('tiptap-preview-preview')
    expect(previews).toHaveLength(2)

    // Verify content reverted to original
    // The second preview is the translation
    expect(previews[1].textContent).toContain('original')
    expect(previews[1].textContent).not.toContain('edited')
  })
})
