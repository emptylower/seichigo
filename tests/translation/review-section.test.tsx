import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import TranslationsUI from '@/app/(authed)/admin/translations/ui'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

// Mock components
vi.mock('@/components/shared/Button', () => ({
  default: ({ children, onClick, className, disabled }: any) => (
    <button onClick={onClick} className={className} disabled={disabled}>
      {children}
    </button>
  ),
}))

vi.mock('next/link', () => ({
  default: ({ children, href, className }: any) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}))

vi.mock('@radix-ui/react-dialog', () => ({
  Root: ({ children }: any) => <div>{children}</div>,
  Portal: ({ children }: any) => <div>{children}</div>,
  Overlay: ({ children }: any) => <div>{children}</div>,
  Content: ({ children }: any) => <div>{children}</div>,
  Title: ({ children }: any) => <div>{children}</div>,
  Description: ({ children }: any) => <div>{children}</div>,
  Close: ({ children }: any) => <div>{children}</div>,
}))

vi.mock('lucide-react', () => ({
  X: () => <span>X</span>,
}))

describe('TranslationsUI Review Section', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    global.fetch = vi.fn()
  })

  it('defaults to ready status and renders ready tasks with subject title', async () => {
    const readyTasks = [
      {
        id: 't1',
        entityType: 'article',
        entityId: 'a1',
        targetLanguage: 'ja',
        status: 'ready',
        createdAt: '2023-01-01T00:00:00.000Z',
        updatedAt: '2023-01-02T00:00:00.000Z',
        error: null,
        subject: { title: '示例文章', subtitle: 'slug：demo', slug: 'demo' },
        target: null,
      },
    ]

    const mockFetch = global.fetch as any
    mockFetch.mockImplementation((url: string) => {
      if (url.startsWith('/api/admin/translations?')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ tasks: readyTasks, total: 1 }),
        })
      }
      if (url.startsWith('/api/admin/translations/stats')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ok: true, counts: { ready: 1 } }),
        })
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      })
    })

    render(<TranslationsUI />)

    await waitFor(() => {
      expect(screen.getByText('示例文章')).toBeInTheDocument()
    })

    expect(screen.getAllByText('文章').length).toBeGreaterThan(0)
    expect(screen.getAllByText('日本語').length).toBeGreaterThan(0)
    expect(screen.getByText('审核')).toBeInTheDocument()
  })
})
