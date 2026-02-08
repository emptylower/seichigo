import React from 'react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

const getSessionMock = vi.fn()
const redirectMock = vi.fn()

vi.mock('@/lib/auth/session', () => ({
  getServerAuthSession: () => getSessionMock(),
}))

vi.mock('next/navigation', () => ({
  redirect: (url: string) => redirectMock(url),
}))

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

vi.mock('@/components/ui/card', () => ({
  Card: ({ children, className }: any) => <div className={`mock-card ${className}`}>{children}</div>,
  CardHeader: ({ children }: any) => <div className="mock-card-header">{children}</div>,
  CardTitle: ({ children }: any) => <div className="mock-card-title">{children}</div>,
  CardContent: ({ children }: any) => <div className="mock-card-content">{children}</div>,
}))

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
}

describe('admin dashboard', () => {
  beforeEach(() => {
    getSessionMock.mockReset()
    vi.unstubAllGlobals()
  })

  it('redirects to signin if no session', async () => {
    getSessionMock.mockResolvedValue(null)
    
    const AdminDashboardPage = (await import('@/app/(authed)/admin/dashboard/page')).default
    try {
      await AdminDashboardPage()
    } catch (e) {
      // Intentional catch: redirect throws an error in Next.js
    }
    expect(redirectMock).toHaveBeenCalledWith('/auth/signin')
  })

  it('shows forbidden for non-admin', async () => {
    getSessionMock.mockResolvedValue({ user: { id: 'user-1', isAdmin: false } })
    
    redirectMock.mockReset()

    const AdminDashboardPage = (await import('@/app/(authed)/admin/dashboard/page')).default
    const { container } = render(await AdminDashboardPage())
    
    expect(container).toHaveTextContent('无权限访问。')
  })

  it('renders stats and recent articles for admin', async () => {
    getSessionMock.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })

    const fetchMock = vi.fn(async (input: any, init?: any) => {
      const url = String(input)
      
      if (url === '/api/admin/dashboard/summary') {
        return jsonResponse({
          ok: true,
          stats: {
            pendingArticles: 5,
            pendingRevisions: 2,
            pendingReviewTotal: 7,
            readyTranslations: 3,
            publishedArticles: 10,
            animeCount: 20,
            cityCount: 30,
            userCount: 40,
            waitlistCount: 2,
          },
          queue: {
            total: 2,
            items: [
              { id: 'a1', kind: 'article', title: 'Recent Article 1', slug: 'recent-1', status: 'in_review', updatedAt: '2025-01-02T00:00:00.000Z', href: '/admin/review/a1' },
              { id: 'r1', kind: 'revision', title: 'Recent Revision 1', slug: null, status: 'in_review', updatedAt: '2025-01-03T00:00:00.000Z', href: '/admin/review/r1' },
            ],
          },
        })
      }

      return jsonResponse({ error: 'not found' }, { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock as any)

    const AdminDashboardPage = (await import('@/app/(authed)/admin/dashboard/page')).default
    render(await AdminDashboardPage())

    await waitFor(() => {
      expect(screen.getByText('待审核队列')).toBeInTheDocument()
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/dashboard/summary', { method: 'GET' })

    expect(screen.getByText('7')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('文章 5 + 修订 2')).toBeInTheDocument()
    expect(screen.getByText('10')).toBeInTheDocument()
    expect(screen.getByText('20')).toBeInTheDocument()
    expect(screen.getByText('30')).toBeInTheDocument()
    expect(screen.getByText('40')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()

    expect(screen.getByText('Recent Article 1')).toBeInTheDocument()
    expect(screen.getByText(/slug: recent-1/)).toBeInTheDocument()
    expect(screen.getByText('Recent Revision 1')).toBeInTheDocument()
  })

  it('handles error state', async () => {
    getSessionMock.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })

    const fetchMock = vi.fn(async (input: any, init?: any) => {
      return jsonResponse({ error: 'API Error' }, { status: 500 })
    })
    vi.stubGlobal('fetch', fetchMock as any)

    const AdminDashboardPage = (await import('@/app/(authed)/admin/dashboard/page')).default
    render(await AdminDashboardPage())

    await waitFor(() => {
      expect(screen.getByText('API Error')).toBeInTheDocument()
    })
  })
})
