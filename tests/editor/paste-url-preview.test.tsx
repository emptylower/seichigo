import React from 'react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, waitFor } from '@testing-library/react'
import RichTextEditor from '@/components/editor/RichTextEditor'

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
}

describe('editor paste url preview', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.unstubAllGlobals()
    vi.stubGlobal('fetch', fetchMock as any)
  })

  it('converts a pasted single URL into an image preview', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, imageUrl: 'https://cdn.example.com/og.png' }))

    const onChange = vi.fn()
    const { container } = render(
      <RichTextEditor initialValue={{ json: null, html: '' }} value={{ json: null, html: '' }} onChange={onChange} />
    )

    await waitFor(() => {
      expect(container.querySelector('.ProseMirror')).toBeTruthy()
    })

    fireEvent.paste(container.querySelector('.ProseMirror') as Element, {
      clipboardData: {
        files: [],
        getData: (t: string) => (t === 'text/plain' ? 'https://example.com/page' : ''),
      },
    })

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [url, init] = fetchMock.mock.calls[0] as any[]
      expect(url).toBe('/api/link-preview')
      expect(init?.method).toBe('POST')
    })

    await waitFor(() => {
      const last = onChange.mock.calls.at(-1)?.[0]
      expect(last?.html).toContain('https://cdn.example.com/og.png')
    })
  })
})

