import React from 'react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

const getSessionMock = vi.fn()

vi.mock('@/lib/auth/session', () => ({
  getServerAuthSession: () => getSessionMock(),
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
    vi.unstubAllGlobals()
  })

  it('shows forbidden for non-admin', async () => {
    getSessionMock.mockResolvedValue({ user: { id: 'user-1', isAdmin: false } })

    const AdminReviewPage = (await import('@/app/(site)/admin/review/page')).default
    render(await AdminReviewPage())

    expect(screen.getByText('无权限访问。')).toBeInTheDocument()
  })

  it('renders in_review list for admin (mock API)', async () => {
    getSessionMock.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })

    const fetchMock = vi.fn(async () =>
      jsonResponse({
        ok: true,
        items: [{ id: 'a1', slug: 'hello', title: 'Hello Article', status: 'in_review', updatedAt: '2025-01-01T00:00:00.000Z' }],
      })
    )
    vi.stubGlobal('fetch', fetchMock as any)

    const AdminReviewPage = (await import('@/app/(site)/admin/review/page')).default
    render(await AdminReviewPage())

    expect(await screen.findByText('Hello Article')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/review/articles?status=in_review', { method: 'GET' })
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
            animeId: 'btr',
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

    const AdminReviewDetailPage = (await import('@/app/(site)/admin/review/[id]/page')).default
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
            animeId: null,
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

    const AdminReviewDetailPage = (await import('@/app/(site)/admin/review/[id]/page')).default
    render(await AdminReviewDetailPage({ params: Promise.resolve({ id: 'a1' }) }))

    expect(await screen.findByText('Hello Article')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '同意发布' }))

    expect(fetchMock).toHaveBeenCalledWith('/api/admin/review/articles/a1/approve', { method: 'POST' })
    expect(await screen.findByText('已同意发布。')).toBeInTheDocument()
  })
})
