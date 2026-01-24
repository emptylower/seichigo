import React from 'react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import FavoritesClient from '@/app/(authed)/me/favorites/ui'

function jsonResponse(body: any, status: number = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('favorites page ui', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('loads favorites list and supports removing mixed sources', async () => {
    const fetchMock = vi.fn()
    ;(globalThis as any).fetch = fetchMock

    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          items: [
            { source: 'db', articleId: 'a1', slug: 'db-1', title: 'DB 1', createdAt: new Date().toISOString() },
            { source: 'mdx', slug: 'mdx-1', title: 'MDX 1', createdAt: new Date().toISOString() },
          ],
        })
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true }))

    render(<FavoritesClient />)

    await waitFor(() => {
      expect(screen.getByText('DB 1')).toBeTruthy()
      expect(screen.getByText('MDX 1')).toBeTruthy()
    })

    fireEvent.click(screen.getAllByText('取消收藏')[1]!)

    await waitFor(() => {
      expect(fetchMock.mock.calls.length).toBe(2)
    })
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/favorites/mdx/mdx-1')
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe('DELETE')
  })
})
