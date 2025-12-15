import React from 'react'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'

const fetchMock = vi.fn()
const replaceMock = vi.fn()
const refreshMock = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock, refresh: refreshMock }),
}))

vi.mock('@/components/editor/RichTextEditor', () => ({
  default: ({ value, onChange }: any) => (
    <textarea
      aria-label="rich-text"
      value={value?.html ?? ''}
      onChange={(e) => onChange({ json: null, html: (e.target as HTMLTextAreaElement).value })}
    />
  ),
}))

import ArticleComposerClient from '@/app/(site)/submit/_components/ArticleComposerClient'

function jsonResponse(body: any, status: number = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('submit/new article composer', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    replaceMock.mockReset()
    refreshMock.mockReset()
    ;(globalThis as any).fetch = fetchMock
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllTimers()
  })

  it('creates a draft after typing content', async () => {
    vi.useFakeTimers()

    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, article: { id: 'a1' } }))

    render(<ArticleComposerClient initial={null} />)

    fireEvent.change(screen.getByLabelText('rich-text'), { target: { value: 'hello' } })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(401)
      await Promise.resolve()
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as any[]
    expect(url).toBe('/api/articles')
    expect(init?.method).toBe('POST')
    expect(replaceMock).toHaveBeenCalledWith('/submit/a1')
  })
})

