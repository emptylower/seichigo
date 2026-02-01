import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import TranslationDetailUI from '../../app/(authed)/admin/translations/[id]/ui'
import { useRouter } from 'next/navigation'

vi.mock('next/navigation', () => ({
  useRouter: vi.fn(),
}))

const mockEditor = {
  state: {
    selection: {
      empty: false,
      from: 0,
      to: 5,
    },
    doc: {
      textBetween: () => 'Selected Text',
    },
  },
  chain: () => ({
    focus: () => ({
      insertContent: vi.fn().mockReturnThis(),
      run: vi.fn(),
    }),
  }),
  isEditable: true,
}

vi.mock('@/components/translation/TipTapPreview', () => ({
  default: ({ mode, content, onChange, onEditorReady }: any) => {
    if (onEditorReady) {
      setTimeout(() => onEditorReady(mockEditor), 0)
    }
    return (
      <div data-testid="tiptap-preview">
        Mode: {mode}
        {mode === 'edit' && (
          <button onClick={() => onChange({ ...content, title: 'Edited Title' })}>
            Simulate Change
          </button>
        )}
      </div>
    )
  },
}))

vi.mock('@tiptap/react/menus', () => ({
  BubbleMenu: ({ children }: any) => <div data-testid="bubble-menu">{children}</div>,
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

describe('TranslationDetailUI', () => {
  const mockTask = {
    id: 'task-1',
    entityType: 'article',
    entityId: 'article-1',
    targetLanguage: 'en',
    status: 'ready',
    sourceContent: { title: 'Source Title' },
    draftContent: { type: 'doc', content: [] }, 
    createdAt: new Date().toISOString(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    ;(useRouter as any).mockReturnValue({ push: vi.fn() })
    global.fetch = vi.fn()
    global.confirm = vi.fn(() => true)
    global.alert = vi.fn()
  })

  it('renders correctly and enters edit mode with re-translate button', async () => {
    ;(global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ task: mockTask }),
    })

    render(<TranslationDetailUI id="task-1" />)

    await waitFor(() => expect(screen.getByText('翻译详情')).toBeInTheDocument())
    
    fireEvent.click(screen.getByText('编辑翻译'))
    
    await waitFor(() => expect(screen.getByText('Mode: edit')).toBeInTheDocument())
    expect(screen.getByText('重新翻译全文')).toBeInTheDocument()
    expect(screen.getByText('确认翻译')).toBeInTheDocument()
  })

  it('handles full re-translate flow', async () => {
     ;(global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ task: mockTask }),
    })

    render(<TranslationDetailUI id="task-1" />)
    await waitFor(() => expect(screen.getByText('翻译详情')).toBeInTheDocument())
    fireEvent.click(screen.getByText('编辑翻译'))

    ;(global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ preview: { type: 'doc', content: ['new content'] } })
    })

    fireEvent.click(screen.getByText('重新翻译全文'))
    
    await waitFor(() => expect(screen.getByText('翻译预览 (全文)')).toBeInTheDocument())
    expect(screen.getByText('应用更改')).toBeInTheDocument()
    
    ;(global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true, updated: {} })
    })
    
    fireEvent.click(screen.getByText('应用更改'))
    
    await waitFor(() => expect(screen.queryByText('翻译预览 (全文)')).not.toBeInTheDocument())
    
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/admin/retranslate/apply',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: expect.stringContaining('article')
      })
    )
  })

  it('handles selected text re-translate flow', async () => {
    ;(global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ task: mockTask }),
    })

    render(<TranslationDetailUI id="task-1" />)
    await waitFor(() => expect(screen.getByText('翻译详情')).toBeInTheDocument())
    fireEvent.click(screen.getByText('编辑翻译'))

    // Wait for editor to be ready and BubbleMenu to appear
    await waitFor(() => expect(screen.getByTestId('bubble-menu')).toBeInTheDocument())
    
    ;(global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ preview: 'Translated Text' })
    })

    fireEvent.click(screen.getByText('✨ 重译选中'))
    
    await waitFor(() => expect(screen.getByText('翻译预览 (选中内容)')).toBeInTheDocument())
    expect(screen.getByText('Selected Text')).toBeInTheDocument()
    expect(screen.getByText('Translated Text')).toBeInTheDocument()
    
    fireEvent.click(screen.getByText('应用更改'))
    expect(screen.queryByText('翻译预览 (选中内容)')).not.toBeInTheDocument()
  })
})
