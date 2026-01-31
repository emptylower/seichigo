import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import TranslationsUI from '@/app/(authed)/admin/translations/ui'

// Mock components
vi.mock('@/components/shared/Button', () => ({
  default: ({ children, onClick, className }: any) => (
    <button onClick={onClick} className={className}>
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

  it('renders pending review section when there are ready tasks', async () => {
    const readyTasks = [
      {
        id: 't1',
        entityType: 'article',
        entityId: 'a1',
        targetLanguage: 'ja',
        status: 'ready',
        createdAt: '2023-01-01',
      },
    ]

    const mockFetch = global.fetch as any
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('status=ready')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ tasks: readyTasks }),
        })
      }
      if (url.includes('status=pending')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ tasks: [] }),
        })
      }
      if (url.includes('/untranslated')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ items: [] }),
        })
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      })
    })

    render(<TranslationsUI />)

    await waitFor(() => {
      expect(screen.getByText(/待审核翻译/)).toBeInTheDocument()
    })
    
    expect(screen.getByText('文章')).toBeInTheDocument()
    expect(screen.getByText('日本語')).toBeInTheDocument()
  })

  it('does not render pending review section when there are no ready tasks', async () => {
    const mockFetch = global.fetch as any
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('status=ready')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ tasks: [] }),
        })
      }
      if (url.includes('status=pending')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ tasks: [] }),
        })
      }
      if (url.includes('/untranslated')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ items: [] }),
        })
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      })
    })

    render(<TranslationsUI />)

    await waitFor(() => {
        expect(screen.queryByText('加载中...')).not.toBeInTheDocument()
    })

    expect(screen.queryByText(/待审核翻译/)).not.toBeInTheDocument()
  })
})
