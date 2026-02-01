import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import TranslationDetailUI from '../../app/(authed)/admin/translations/[id]/ui'
import { useRouter } from 'next/navigation'

vi.mock('next/navigation', () => ({
  useRouter: vi.fn(),
}))

vi.mock('@/components/translation/TipTapPreview', () => ({
  default: ({ mode, content, onChange }: any) => (
    <div data-testid="tiptap-preview">
      Mode: {mode}
      {mode === 'edit' && (
        <button onClick={() => onChange({ ...content, title: 'Edited Title' })}>
          Simulate Change
        </button>
      )}
    </div>
  ),
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
    expect(screen.getByText('重新翻译')).toBeInTheDocument()
    expect(screen.getByText('确认翻译')).toBeInTheDocument()
  })

  it('handles re-translate flow', async () => {
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

    fireEvent.click(screen.getByText('重新翻译'))
    
    await waitFor(() => expect(screen.getByText('翻译预览')).toBeInTheDocument())
    expect(screen.getByText('应用更改')).toBeInTheDocument()
    
    fireEvent.click(screen.getByText('应用更改'))
    expect(screen.queryByText('翻译预览')).not.toBeInTheDocument()
  })
})
