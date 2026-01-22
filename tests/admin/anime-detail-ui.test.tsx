import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

const getSessionMock = vi.fn()
const pushMock = vi.fn()

vi.mock('@/lib/auth/session', () => ({
  getServerAuthSession: () => getSessionMock(),
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

vi.mock('@/components/shared/CoverField', () => ({
  default: () => <div data-testid="cover-field" />,
}))

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
}

describe('admin anime detail ui', () => {
  beforeEach(() => {
    getSessionMock.mockReset()
    pushMock.mockReset()
    vi.unstubAllGlobals()
  })

  it('allows admin to rename anime', async () => {
    getSessionMock.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })

    const fetchMock = vi.fn(async (input: any, init?: any) => {
      const url = String(input)
      const method = String(init?.method || 'GET').toUpperCase()

      if (url === '/api/admin/anime/btr' && method === 'GET') {
        return jsonResponse({
          ok: true,
          anime: { id: 'btr', name: 'Old Name', summary: '', cover: null, hidden: false },
        })
      }

      if (url === '/api/admin/anime/btr' && method === 'PATCH') {
        const body = JSON.parse(String(init?.body || '{}'))
        return jsonResponse({
          ok: true,
          anime: { id: 'btr', name: body.name, summary: '', cover: null, hidden: false },
        })
      }

      return jsonResponse({ error: 'not found' }, { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock as any)

    const Page = (await import('../../app/(site)/admin/panel/anime/[id]/page')).default
    render(await Page({ params: Promise.resolve({ id: 'btr' }) }))

    expect(await screen.findByText('Old Name')).toBeInTheDocument()

    fireEvent.change(await screen.findByPlaceholderText('请输入作品名…'), { target: { value: '  New Name  ' } })
    fireEvent.click(screen.getByRole('button', { name: '保存作品名' }))

    expect(fetchMock).toHaveBeenCalledWith('/api/admin/anime/btr', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'New Name' }),
    })
    expect(await screen.findByText('New Name')).toBeInTheDocument()
  })
})
