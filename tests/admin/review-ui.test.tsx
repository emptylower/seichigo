import React from 'react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const getSessionMock = vi.fn()
const pushMock = vi.fn()
const toastSuccessMock = vi.fn()
const toastErrorMock = vi.fn()

vi.mock('@/lib/auth/session', () => ({
  getServerAuthSession: () => getSessionMock(),
}))

vi.mock('@/hooks/useAdminToast', () => ({
  useAdminToast: () => ({
    toasts: [],
    show: vi.fn(),
    success: toastSuccessMock,
    error: toastErrorMock,
    info: vi.fn(),
    dismiss: vi.fn(),
    clear: vi.fn(),
  }),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: pushMock, refresh: vi.fn() }),
  redirect: (_url: string) => {},
}))

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
}

describe('admin review ui', () => {
  beforeEach(() => {
    getSessionMock.mockReset()
    pushMock.mockReset()
    toastSuccessMock.mockReset()
    toastErrorMock.mockReset()
    vi.unstubAllGlobals()
  })

  it('shows forbidden for non-admin', async () => {
    getSessionMock.mockResolvedValue({ user: { id: 'user-1', isAdmin: false } })

    const AdminReviewPage = (await import('@/app/(authed)/admin/review/page')).default
    render(await AdminReviewPage())

    expect(screen.getByText('无权限访问。')).toBeInTheDocument()
  })

  it('renders in_review list for admin (mock API)', async () => {
    getSessionMock.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })

    const fetchMock = vi.fn(async (input: any, init?: any) => {
      const url = String(input)
      const method = String(init?.method || 'GET').toUpperCase()

      if (url === '/api/admin/review/queue?status=in_review&page=1&pageSize=20' && method === 'GET') {
        return jsonResponse({
          ok: true,
          items: [
            { id: 'a1', kind: 'article', articleId: 'a1', slug: 'hello', title: 'Hello Article', status: 'in_review', updatedAt: '2025-01-01T00:00:00.000Z' },
            { id: 'r1', kind: 'revision', articleId: 'a2', slug: null, title: 'Updated Article', status: 'in_review', updatedAt: '2025-01-03T00:00:00.000Z' },
          ],
          total: 2,
          page: 1,
          pageSize: 20,
        })
      }

      return jsonResponse({ error: 'not found' }, { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock as any)

    const AdminReviewPage = (await import('@/app/(authed)/admin/review/page')).default
    render(await AdminReviewPage())

    expect(await screen.findByText('Hello Article')).toBeInTheDocument()
    expect(await screen.findByText('Updated Article')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/review/queue?status=in_review&page=1&pageSize=20', { method: 'GET' })
  })

  it('shows loading skeleton then empty state', async () => {
    getSessionMock.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })

    let resolveFetch: ((res: Response) => void) | null = null
    const fetchMock = vi.fn(async () => {
      return await new Promise<Response>((resolve) => {
        resolveFetch = resolve
      })
    })
    vi.stubGlobal('fetch', fetchMock as any)

    const AdminReviewPage = (await import('@/app/(authed)/admin/review/page')).default
    render(await AdminReviewPage())

    await waitFor(() => {
      expect(document.querySelector('.animate-pulse')).toBeTruthy()
    })

    resolveFetch?.(jsonResponse({
      ok: true,
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
    }))

    expect(await screen.findByText('暂无待审核内容')).toBeInTheDocument()
  })

  it('shows error state when queue load fails', async () => {
    getSessionMock.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })

    const fetchMock = vi.fn(async () => jsonResponse({ error: 'queue failed' }, { status: 500 }))
    vi.stubGlobal('fetch', fetchMock as any)

    const AdminReviewPage = (await import('@/app/(authed)/admin/review/page')).default
    render(await AdminReviewPage())

    expect(await screen.findByText('queue failed')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument()
  })

  it('reject requires reason and posts to reject endpoint', async () => {
    getSessionMock.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })

    const fetchMock = vi.fn(async (input: any, init?: any) => {
      const url = String(input)
      const method = String(init?.method || 'GET').toUpperCase()

	      if (url === '/api/articles/a1' && method === 'GET') {
	        return jsonResponse({
	          ok: true,
	          article: {
	            id: 'a1',
	            slug: 'hello',
	            title: 'Hello Article',
	            animeIds: ['btr'],
	            city: 'Tokyo',
	            routeLength: null,
	            tags: ['shimokitazawa'],
	            contentHtml: '<p>Preview</p>',
            status: 'in_review',
            rejectReason: null,
            publishedAt: null,
            updatedAt: '2025-01-01T00:00:00.000Z',
          },
        })
      }

      if (url === '/api/admin/review/articles/a1/reject' && method === 'POST') {
        return jsonResponse({ ok: true, article: { id: 'a1', status: 'rejected', rejectReason: 'needs more detail' } })
      }

      return jsonResponse({ error: 'not found' }, { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock as any)

    const AdminReviewDetailPage = (await import('@/app/(authed)/admin/review/[id]/page')).default
    render(await AdminReviewDetailPage({ params: Promise.resolve({ id: 'a1' }) }))

    expect(await screen.findByText('Hello Article')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '拒绝' }))
    expect(screen.getByText('请填写拒绝原因')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('原因（必填）'), { target: { value: 'needs more detail' } })
    fireEvent.click(screen.getByRole('button', { name: '拒绝' }))

    expect(fetchMock).toHaveBeenCalledWith('/api/admin/review/articles/a1/reject', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'needs more detail' }),
    })

    expect(await screen.findByText('已拒绝。')).toBeInTheDocument()
  })

  it('posts to approve endpoint', async () => {
    getSessionMock.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })

    const fetchMock = vi.fn(async (input: any, init?: any) => {
      const url = String(input)
      const method = String(init?.method || 'GET').toUpperCase()

	      if (url === '/api/articles/a1' && method === 'GET') {
	        return jsonResponse({
	          ok: true,
	          article: {
	            id: 'a1',
	            slug: 'hello',
	            title: 'Hello Article',
	            animeIds: [],
	            city: null,
	            routeLength: null,
	            tags: [],
	            contentHtml: '<p>Preview</p>',
            status: 'in_review',
            rejectReason: null,
            publishedAt: null,
            updatedAt: '2025-01-01T00:00:00.000Z',
          },
        })
      }

      if (url === '/api/admin/review/articles/a1/approve' && method === 'POST') {
        return jsonResponse({ ok: true, article: { id: 'a1', status: 'published', publishedAt: '2025-01-02T00:00:00.000Z' } })
      }

      return jsonResponse({ error: 'not found' }, { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock as any)

    const AdminReviewDetailPage = (await import('@/app/(authed)/admin/review/[id]/page')).default
    render(await AdminReviewDetailPage({ params: Promise.resolve({ id: 'a1' }) }))

    expect(await screen.findByText('Hello Article')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '同意发布' }))

    expect(fetchMock).toHaveBeenCalledWith('/api/admin/review/articles/a1/approve', { method: 'POST' })
    expect(await screen.findByText('已同意发布。')).toBeInTheDocument()
  })

  it('allows admin to update article slug before approving', async () => {
    getSessionMock.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })

    const fetchMock = vi.fn(async (input: any, init?: any) => {
      const url = String(input)
      const method = String(init?.method || 'GET').toUpperCase()

	      if (url === '/api/articles/a1' && method === 'GET') {
	        return jsonResponse({
	          ok: true,
	          article: {
	            id: 'a1',
	            slug: 'hello',
	            title: 'Hello Article',
	            animeIds: ['btr'],
	            city: null,
	            routeLength: null,
	            tags: [],
	            contentHtml: '<p>Preview</p>',
            status: 'in_review',
            rejectReason: null,
            publishedAt: null,
            updatedAt: '2025-01-01T00:00:00.000Z',
          },
        })
      }

      if (url === '/api/admin/review/articles/a1' && method === 'PATCH') {
        return jsonResponse({ ok: true, article: { id: 'a1', slug: 'btr-hello' } })
      }

      return jsonResponse({ error: 'not found' }, { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock as any)

    const AdminReviewDetailPage = (await import('@/app/(authed)/admin/review/[id]/page')).default
    render(await AdminReviewDetailPage({ params: Promise.resolve({ id: 'a1' }) }))

    expect(await screen.findByText('Hello Article')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('slug（必填）'), { target: { value: 'btr-hello' } })
    fireEvent.click(screen.getByRole('button', { name: '保存 slug' }))

    expect(fetchMock).toHaveBeenCalledWith('/api/admin/review/articles/a1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: 'btr-hello' }),
    })
  })

  it('supports approving a revision in the same review detail page', async () => {
    getSessionMock.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })

    const fetchMock = vi.fn(async (input: any, init?: any) => {
      const url = String(input)
      const method = String(init?.method || 'GET').toUpperCase()

      if (url === '/api/articles/r1' && method === 'GET') {
        return jsonResponse({ error: 'not found' }, { status: 404 })
      }

      if (url === '/api/revisions/r1' && method === 'GET') {
        return jsonResponse({
          ok: true,
          revision: {
            id: 'r1',
            articleId: 'a1',
            authorId: 'user-1',
            title: 'Updated Article',
            animeIds: ['btr'],
            city: null,
            routeLength: null,
            tags: [],
            cover: null,
            contentJson: null,
            contentHtml: '<p>Updated Preview</p>',
            status: 'in_review',
            rejectReason: null,
            createdAt: '2025-01-01T00:00:00.000Z',
            updatedAt: '2025-01-03T00:00:00.000Z',
          },
        })
      }

      if (url === '/api/admin/review/revisions/r1/approve' && method === 'POST') {
        return jsonResponse({ ok: true, revision: { id: 'r1', status: 'approved' } })
      }

      return jsonResponse({ error: 'not found' }, { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock as any)

    const AdminReviewDetailPage = (await import('@/app/(authed)/admin/review/[id]/page')).default
    render(await AdminReviewDetailPage({ params: Promise.resolve({ id: 'r1' }) }))

    expect(await screen.findByText('Updated Article')).toBeInTheDocument()
    expect(screen.queryByLabelText('slug（必填）')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '同意发布' }))

    expect(fetchMock).toHaveBeenCalledWith('/api/admin/review/revisions/r1/approve', { method: 'POST' })
    expect(await screen.findByText('已同意发布。')).toBeInTheDocument()
  })
})
