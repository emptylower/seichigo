import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import AdminAnimeListClient from '@/app/(authed)/admin/panel/anime/ui'

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

describe('admin anime list ui', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it('renames anime id from list modal', async () => {
    const fetchMock = vi.fn(async (input: any, init?: any) => {
      const url = String(input)
      const method = String(init?.method || 'GET').toUpperCase()

      if (url.startsWith('/api/admin/anime?q=') && method === 'GET') {
        const query = new URL(`http://localhost${url}`).searchParams.get('q') || ''
        if (!query) {
          return jsonResponse({
            ok: true,
            items: [{ id: '天气之子', name: '天气之子', alias: [], hidden: false }],
          })
        }
        return jsonResponse({
          ok: true,
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

    render(<AdminAnimeListClient />)

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
