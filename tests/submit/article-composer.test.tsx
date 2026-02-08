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

import ArticleComposerClient from '@/app/(authed)/submit/_components/ArticleComposerClient'

function jsonResponse(body: any, status: number = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

const baseInitial = {
  id: 'a1',
  title: 'My Title',
  seoTitle: null,
  description: null,
  animeIds: [],
  city: null,
  routeLength: null,
  tags: [],
  cover: null,
  contentJson: null,
  contentHtml: '',
  status: 'draft' as const,
  rejectReason: null,
  updatedAt: new Date('2025-01-01T00:00:00.000Z').toISOString(),
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
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, article: { id: 'a1' } }))

    render(<ArticleComposerClient initial={null} />)

    const editor = await screen.findByLabelText('rich-text')
    vi.useFakeTimers()
    fireEvent.change(editor, { target: { value: 'hello' } })

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

  it('auto-saves latest content after debounce (no extra saves)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, article: { updatedAt: new Date().toISOString() } }))

    render(<ArticleComposerClient initial={baseInitial} />)

    const editor = await screen.findByLabelText('rich-text')
    vi.useFakeTimers()
    fireEvent.change(editor, { target: { value: 'A' } })
    fireEvent.change(editor, { target: { value: 'B' } })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(801)
      await Promise.resolve()
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as any[]
    expect(url).toBe('/api/articles/a1')
    expect(init?.method).toBe('PATCH')
    expect(init?.body).toBe(JSON.stringify({ title: 'My Title', contentJson: null, contentHtml: 'B' }))
  })

  it('queues saves while one request is in flight (prevents stale overwrite)', async () => {
    let resolveFirst: ((resp: Response) => void) | null = null
    fetchMock
      .mockReturnValueOnce(
        new Promise<Response>((resolve) => {
          resolveFirst = resolve
        })
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true, article: { updatedAt: new Date().toISOString() } }))

    render(<ArticleComposerClient initial={baseInitial} />)

    const editor = await screen.findByLabelText('rich-text')
    vi.useFakeTimers()
    fireEvent.change(editor, { target: { value: 'A' } })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(801)
      await Promise.resolve()
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    fireEvent.change(editor, { target: { value: 'B' } })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(801)
      await Promise.resolve()
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveFirst?.(jsonResponse({ ok: true, article: { updatedAt: new Date().toISOString() } }))
      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(1)
      await Promise.resolve()
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [url2, init2] = fetchMock.mock.calls[1] as any[]
    expect(url2).toBe('/api/articles/a1')
    expect(init2?.method).toBe('PATCH')
    expect(init2?.body).toBe(JSON.stringify({ title: 'My Title', contentJson: null, contentHtml: 'B' }))
  })

  it('shows retry when autosave fails and allows manual retry', async () => {
    let rejectFirst: ((err: any) => void) | null = null
    fetchMock
      .mockReturnValueOnce(
        new Promise<Response>((_resolve, reject) => {
          rejectFirst = reject
        })
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true, article: { updatedAt: new Date().toISOString() } }))

    render(<ArticleComposerClient initial={baseInitial} />)

    const editor = await screen.findByLabelText('rich-text')
    vi.useFakeTimers()
    fireEvent.change(editor, { target: { value: 'A' } })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(801)
      await Promise.resolve()
    })

    await act(async () => {
      rejectFirst?.(new Error('Network down'))
      await Promise.resolve()
    })

    expect(screen.getByText('Network down')).toBeInTheDocument()
    const retry = screen.getByRole('button', { name: '重试保存' })

    await act(async () => {
      fireEvent.click(retry)
      await Promise.resolve()
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(screen.getByText('已保存')).toBeInTheDocument()
  })

  it('starts revision from published article', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, revision: { id: 'r1' } }))

    render(<ArticleComposerClient initial={{ ...baseInitial, status: 'published' as const }} />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '发起更新' }))
      await Promise.resolve()
    })

    expect(fetchMock).toHaveBeenCalledWith('/api/articles/a1/revision', { method: 'POST' })
    expect(replaceMock).toHaveBeenCalledWith('/submit/revisions/r1')
  })
})

describe('revision composer', () => {
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

  it('auto-saves to revision endpoint', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }))

    render(<ArticleComposerClient initial={baseInitial as any} mode="revision" />)

    const editor = await screen.findByLabelText('rich-text')
    vi.useFakeTimers()
    fireEvent.change(editor, { target: { value: 'B' } })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(801)
      await Promise.resolve()
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as any[]
    expect(url).toBe('/api/revisions/a1')
    expect(init?.method).toBe('PATCH')
  })
})
