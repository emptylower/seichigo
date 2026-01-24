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

describe('admin panel ui', () => {
  beforeEach(() => {
    getSessionMock.mockReset()
    vi.unstubAllGlobals()
  })

  it('shows forbidden for non-admin', async () => {
    getSessionMock.mockResolvedValue({ user: { id: 'user-1', isAdmin: false } })

    const AdminPanelPage = (await import('@/app/(authed)/admin/panel/page')).default
    render(await AdminPanelPage())

    expect(screen.getByText('无权限访问。')).toBeInTheDocument()
  })

  it('renders in_review list and can switch to published list', async () => {
    getSessionMock.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })

    const fetchMock = vi.fn(async (input: any, init?: any) => {
      const url = String(input)
      const method = String(init?.method || 'GET').toUpperCase()

      if (url === '/api/admin/review/articles?status=in_review' && method === 'GET') {
        return jsonResponse({
          ok: true,
          items: [{ id: 'a1', slug: 'hello', title: 'Hello Article', status: 'in_review', updatedAt: '2025-01-01T00:00:00.000Z' }],
        })
      }

      if (url === '/api/admin/review/revisions?status=in_review' && method === 'GET') {
        return jsonResponse({
          ok: true,
          items: [
            { id: 'r1', articleId: 'a2', authorId: 'user-2', title: 'Updated Article', status: 'in_review', updatedAt: '2025-01-03T00:00:00.000Z' },
          ],
        })
      }

      if (url === '/api/admin/review/articles?status=published' && method === 'GET') {
        return jsonResponse({
          ok: true,
          items: [{ id: 'p1', slug: 'pub', title: 'Published Article', status: 'published', updatedAt: '2025-01-02T00:00:00.000Z' }],
        })
      }

      return jsonResponse({ error: 'not found' }, { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock as any)

    const AdminPanelPage = (await import('@/app/(authed)/admin/panel/page')).default
    render(await AdminPanelPage())

    expect(await screen.findByText('Hello Article')).toBeInTheDocument()
    expect(await screen.findByText('Updated Article')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/review/articles?status=in_review', { method: 'GET' })
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/review/revisions?status=in_review', { method: 'GET' })

    fireEvent.click(screen.getByRole('button', { name: '已发布' }))

    expect(await screen.findByText('Published Article')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/review/articles?status=published', { method: 'GET' })
  })

  it('unpublish requires reason and posts to unpublish endpoint', async () => {
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
            status: 'published',
            rejectReason: null,
            publishedAt: '2025-01-02T00:00:00.000Z',
            updatedAt: '2025-01-02T00:00:00.000Z',
          },
        })
      }

      if (url === '/api/admin/review/articles/a1/unpublish' && method === 'POST') {
        return jsonResponse({ ok: true, article: { id: 'a1', status: 'rejected', rejectReason: 'policy update' } })
      }

      return jsonResponse({ error: 'not found' }, { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock as any)

    const AdminPanelArticlePage = (await import('@/app/(authed)/admin/panel/articles/[id]/page')).default
    render(await AdminPanelArticlePage({ params: Promise.resolve({ id: 'a1' }) }))

    expect(await screen.findByText('Hello Article')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '下架' }))
    expect(screen.getByText('请填写下架原因')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('下架原因（必填）'), { target: { value: 'policy update' } })
    fireEvent.click(screen.getByRole('button', { name: '下架' }))

    expect(fetchMock).toHaveBeenCalledWith('/api/admin/review/articles/a1/unpublish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'policy update' }),
    })

    expect(await screen.findByText('已下架。')).toBeInTheDocument()
  })

  it('allows admin to update slug on published article page', async () => {
    getSessionMock.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })

    const fetchMock = vi.fn(async (input: any, init?: any) => {
      const url = String(input)
      const method = String(init?.method || 'GET').toUpperCase()

      if (url === '/api/articles/a1' && method === 'GET') {
        return jsonResponse({
          ok: true,
          article: {
            id: 'a1',
            slug: 'post-2562e8439a',
            title: 'Hello Article',
            animeIds: ['btr'],
            city: 'Tokyo',
            routeLength: null,
            tags: [],
            contentHtml: '<p>Preview</p>',
            status: 'published',
            rejectReason: null,
            publishedAt: '2025-01-02T00:00:00.000Z',
            updatedAt: '2025-01-02T00:00:00.000Z',
          },
        })
      }

      if (url === '/api/admin/review/articles/a1' && method === 'PATCH') {
        return jsonResponse({ ok: true, article: { id: 'a1', slug: 'btr-hello' } })
      }

      return jsonResponse({ error: 'not found' }, { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock as any)

    const AdminPanelArticlePage = (await import('@/app/(authed)/admin/panel/articles/[id]/page')).default
    render(await AdminPanelArticlePage({ params: Promise.resolve({ id: 'a1' }) }))

    expect(await screen.findByText('Hello Article')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('slug（必填）'), { target: { value: 'btr-hello' } })
    fireEvent.click(screen.getByRole('button', { name: '保存 slug' }))

    expect(fetchMock).toHaveBeenCalledWith('/api/admin/review/articles/a1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: 'btr-hello' }),
    })
  })
})
