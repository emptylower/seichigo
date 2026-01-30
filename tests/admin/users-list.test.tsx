import React from 'react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const getSessionMock = vi.fn()

vi.mock('@/lib/auth/session', () => ({
  getServerAuthSession: () => getSessionMock(),
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/admin/users',
  useSearchParams: () => new URLSearchParams(),
}))

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
}

describe('Admin Users List', () => {
  beforeEach(() => {
    getSessionMock.mockReset()
    vi.unstubAllGlobals()
  })

  it('renders forbidden for non-admin', async () => {
    getSessionMock.mockResolvedValue({ user: { id: 'user-1', isAdmin: false } })

    const UsersListPage = (await import('@/app/(authed)/admin/users/page')).default
    // @ts-ignore - Async Server Component
    const ui = await UsersListPage()
    render(ui)

    expect(screen.getByText('无权限访问')).toBeInTheDocument()
  })

  it('renders user list for admin', async () => {
    getSessionMock.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })

    const mockUsers = [
      {
        id: 'u1',
        email: 'test@example.com',
        name: 'Test User',
        isAdmin: false,
        disabled: false,
        createdAt: '2025-01-01T00:00:00.000Z',
        articleCount: 5,
      },
      {
        id: 'u2',
        email: 'admin@example.com',
        name: 'Admin User',
        isAdmin: true,
        disabled: true,
        createdAt: '2025-01-02T00:00:00.000Z',
        articleCount: 10,
      },
    ]

    const fetchMock = vi.fn(async (input: any) => {
      const url = String(input)
      if (url.includes('/api/admin/users')) {
        return jsonResponse({
          ok: true,
          users: mockUsers,
          total: 2,
          page: 1,
          pageSize: 20,
        })
      }
      return jsonResponse({ error: 'not found' }, { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock as any)

    const UsersListClient = (await import('@/app/(authed)/admin/users/ui')).default
    render(<UsersListClient />)

    // Check loading state
    expect(screen.getByText('加载中...')).toBeInTheDocument()

    // Check data loaded
    await waitFor(() => {
      expect(screen.getByText('test@example.com')).toBeInTheDocument()
    })
    
    expect(screen.getByText('Test User')).toBeInTheDocument()
    expect(screen.getByText('admin@example.com')).toBeInTheDocument()
    
    // Check Badges
    expect(screen.getByText('管理员')).toBeInTheDocument()
    expect(screen.getByText('禁用')).toBeInTheDocument()

    // Check article count
    expect(screen.getByText('5')).toBeInTheDocument()
    expect(screen.getByText('10')).toBeInTheDocument()
  })

  it('handles search', async () => {
    const fetchMock = vi.fn(async (input: any) => {
      const url = String(input)
      if (url.includes('q=searchterm')) {
        return jsonResponse({
          ok: true,
          users: [{
             id: 'u1',
             email: 'searchterm@example.com',
             name: 'Search Match',
             isAdmin: false,
             disabled: false,
             createdAt: '2025-01-01T00:00:00.000Z',
             articleCount: 0,
          }],
          total: 1,
          page: 1,
          pageSize: 20,
        })
      }
      return jsonResponse({
        ok: true,
        users: [],
        total: 0,
        page: 1,
        pageSize: 20,
      })
    })
    vi.stubGlobal('fetch', fetchMock as any)

    const UsersListClient = (await import('@/app/(authed)/admin/users/ui')).default
    render(<UsersListClient />)

    const searchInput = screen.getByPlaceholderText('搜索邮箱或名称...')
    fireEvent.change(searchInput, { target: { value: 'searchterm' } })

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('q=searchterm'))
    }, { timeout: 1000 }) // Wait for debounce

    expect(await screen.findByText('searchterm@example.com')).toBeInTheDocument()
  })
})
