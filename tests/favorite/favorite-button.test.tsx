import React from 'react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import FavoriteButton from '@/components/content/FavoriteButton'

function jsonResponse(body: any, status: number = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('FavoriteButton', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('toggles DB favorite via POST + DELETE', async () => {
    const fetchMock = vi.fn()
    ;(globalThis as any).fetch = fetchMock

    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }))
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }))

    render(<FavoriteButton target={{ source: 'db', articleId: 'a1' }} initialFavorited={false} loggedIn={true} />)

    fireEvent.click(screen.getByRole('button', { name: '收藏' }))
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled()
    })
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/favorites')
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('POST')
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(JSON.stringify({ source: 'db', articleId: 'a1' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '已收藏' })).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: '已收藏' }))
    await waitFor(() => {
      expect(fetchMock.mock.calls.length).toBe(2)
    })
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/favorites/a1')
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe('DELETE')
  })

  it('toggles MDX favorite via POST + DELETE', async () => {
    const fetchMock = vi.fn()
    ;(globalThis as any).fetch = fetchMock

    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }))
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }))

    render(<FavoriteButton target={{ source: 'mdx', slug: 'mdx-1' }} initialFavorited={false} loggedIn={true} />)

    fireEvent.click(screen.getByRole('button', { name: '收藏' }))
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled()
    })
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/favorites')
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('POST')
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(JSON.stringify({ source: 'mdx', slug: 'mdx-1' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '已收藏' })).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: '已收藏' }))
    await waitFor(() => {
      expect(fetchMock.mock.calls.length).toBe(2)
    })
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/favorites/mdx/mdx-1')
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe('DELETE')
  })
})

