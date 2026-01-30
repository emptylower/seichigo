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

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
}))

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
}

describe('admin user detail page', () => {
  beforeEach(() => {
    getSessionMock.mockReset()
    vi.unstubAllGlobals()
  })

  it('renders user detail and content lists', async () => {
    const fetchMock = vi.fn(async (input: any, init?: any) => {
      const url = String(input)
      if (url.includes('/api/admin/users/user-123')) {
        return jsonResponse({
          ok: true,
          user: {
            id: 'user-123',
            email: 'test@example.com',
            name: 'Test User',
            isAdmin: false,
            disabled: false,
            createdAt: '2025-01-01T00:00:00.000Z',
          },
          articles: [
            { id: 'a1', slug: 'post-1', title: 'Article 1', status: 'published', publishedAt: '2025-01-02T00:00:00.000Z', createdAt: '2025-01-02T00:00:00.000Z' }
          ],
          drafts: [
            { id: 'd1', slug: 'draft-1', title: 'Draft 1', status: 'draft', createdAt: '2025-01-03T00:00:00.000Z', updatedAt: '2025-01-03T00:00:00.000Z' }
          ],
          favorites: []
        })
      }
      return jsonResponse({ error: 'not found' }, { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock as any)
    vi.stubGlobal('confirm', vi.fn(() => true))
    vi.stubGlobal('alert', vi.fn())

    const UserDetailPage = (await import('@/app/(authed)/admin/users/[id]/page')).default
    render(await UserDetailPage({ params: Promise.resolve({ id: 'user-123' }) }))

    expect(await screen.findByText('test@example.com')).toBeInTheDocument()
    expect(screen.getByText('Test User')).toBeInTheDocument()
    expect(screen.getByText('用户详情')).toBeInTheDocument()
    
    expect(screen.getByText('Article 1')).toBeInTheDocument()
    
    fireEvent.click(screen.getByRole('button', { name: /草稿箱/ }))
    expect(await screen.findByText('Draft 1')).toBeInTheDocument()
  })

  it('can toggle admin status', async () => {
    const fetchMock = vi.fn(async (input: any, init?: any) => {
      const url = String(input)
      const method = init?.method || 'GET'
      
      if (method === 'GET') {
        return jsonResponse({
          ok: true,
          user: {
            id: 'user-123',
            email: 'test@example.com',
            name: 'Test User',
            isAdmin: false,
            disabled: false,
            createdAt: '2025-01-01T00:00:00.000Z',
          },
          articles: [], drafts: [], favorites: []
        })
      }
      
      if (method === 'PATCH' && url.includes('/api/admin/users/user-123')) {
        const body = JSON.parse(init.body)
        return jsonResponse({
          ok: true,
          user: {
            id: 'user-123',
            email: 'test@example.com',
            name: 'Test User',
            isAdmin: body.isAdmin,
            disabled: false,
            createdAt: '2025-01-01T00:00:00.000Z',
          },
        })
      }
      return jsonResponse({ error: 'error' }, { status: 500 })
    })
    
    vi.stubGlobal('fetch', fetchMock as any)
    const confirmMock = vi.fn(() => true)
    vi.stubGlobal('confirm', confirmMock)

    const UserDetailPage = (await import('@/app/(authed)/admin/users/[id]/page')).default
    render(await UserDetailPage({ params: Promise.resolve({ id: 'user-123' }) }))

    const toggleBtn = await screen.findByRole('button', { name: '设为管理员' })
    fireEvent.click(toggleBtn)

    expect(confirmMock).toHaveBeenCalledWith('确定要设为管理员吗？')
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/admin/users/user-123'), expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ isAdmin: true })
    }))
    
    expect(await screen.findByRole('button', { name: '取消管理员' })).toBeInTheDocument()
  })

  it('can toggle disabled status', async () => {
    const fetchMock = vi.fn(async (input: any, init?: any) => {
      const url = String(input)
      const method = init?.method || 'GET'
      
      if (method === 'GET') {
        return jsonResponse({
          ok: true,
          user: {
            id: 'user-123',
            email: 'test@example.com',
            name: 'Test User',
            isAdmin: false,
            disabled: false,
            createdAt: '2025-01-01T00:00:00.000Z',
          },
          articles: [], drafts: [], favorites: []
        })
      }
      
      if (method === 'PATCH' && url.includes('/api/admin/users/user-123')) {
        const body = JSON.parse(init.body)
        return jsonResponse({
          ok: true,
          user: {
            id: 'user-123',
            email: 'test@example.com',
            name: 'Test User',
            isAdmin: false,
            disabled: body.disabled,
            createdAt: '2025-01-01T00:00:00.000Z',
          },
        })
      }
      return jsonResponse({ error: 'error' }, { status: 500 })
    })
    
    vi.stubGlobal('fetch', fetchMock as any)
    const confirmMock = vi.fn(() => true)
    vi.stubGlobal('confirm', confirmMock)

    const UserDetailPage = (await import('@/app/(authed)/admin/users/[id]/page')).default
    render(await UserDetailPage({ params: Promise.resolve({ id: 'user-123' }) }))

    const toggleBtn = await screen.findByRole('button', { name: '禁用账户' })
    fireEvent.click(toggleBtn)

    expect(confirmMock).toHaveBeenCalledWith('确定要禁用账户吗？')
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/admin/users/user-123'), expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ disabled: true })
    }))
    
    expect(await screen.findByRole('button', { name: '启用账户' })).toBeInTheDocument()
  })
})
