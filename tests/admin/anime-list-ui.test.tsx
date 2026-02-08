import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import AdminAnimeListClient from '@/app/(authed)/admin/panel/anime/ui'

const toastSuccessMock = vi.fn()
const toastErrorMock = vi.fn()

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
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

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
}

describe('admin anime list ui', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    toastSuccessMock.mockReset()
    toastErrorMock.mockReset()
  })

  it('renames anime id from list modal', async () => {
    const fetchMock = vi.fn(async (input: any, init?: any) => {
      const url = String(input)
      const method = String(init?.method || 'GET').toUpperCase()

      if (url.startsWith('/api/admin/anime?') && method === 'GET') {
        const query = new URL(`http://localhost${url}`).searchParams.get('q') || ''
        if (!query) {
          return jsonResponse({
            ok: true,
            total: 1,
            page: 1,
            pageSize: 36,
            items: [{ id: '天气之子', name: '天气之子', alias: [], hidden: false }],
          })
        }
        return jsonResponse({
          ok: true,
          total: 1,
          page: 1,
          pageSize: 36,
          items: [{ id: 'weathering-with-you', name: '天气之子', alias: [], hidden: false }],
        })
      }

      if (url === '/api/admin/anime/%E5%A4%A9%E6%B0%94%E4%B9%8B%E5%AD%90' && method === 'PATCH') {
        return jsonResponse({
          ok: true,
          anime: { id: 'weathering-with-you', name: '天气之子', alias: [], hidden: false },
        })
      }

      return jsonResponse({ error: 'not found' }, { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock as any)

    render(
      <AdminAnimeListClient
        initialItems={[{ id: '天气之子', name: '天气之子', alias: [], hidden: false }]}
        initialPage={1}
        initialPageSize={36}
        initialTotal={1}
        initialQuery=""
      />
    )

    expect(await screen.findByRole('link', { name: '天气之子' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '改 ID' }))

    const input = await screen.findByLabelText('新的作品 ID')
    fireEvent.change(input, { target: { value: 'weathering-with-you' } })
    fireEvent.click(screen.getByRole('button', { name: '确认更新 ID' }))

    expect(fetchMock).toHaveBeenCalledWith('/api/admin/anime/%E5%A4%A9%E6%B0%94%E4%B9%8B%E5%AD%90', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nextId: 'weathering-with-you' }),
    })
  })
})
