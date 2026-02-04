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

describe('editor paste images', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.unstubAllGlobals()
    vi.stubGlobal('fetch', fetchMock as any)
  })

  it('uploads pasted images sequentially and inserts in order', async () => {
    let resolveFirst!: (resp: Response) => void
    fetchMock
      .mockReturnValueOnce(
        new Promise<Response>((resolve) => {
          resolveFirst = resolve
        })
      )
      .mockResolvedValueOnce(jsonResponse({ id: '2', url: '/assets/2' }))

    const onChange = vi.fn()
    const { container } = render(
      <RichTextEditor initialValue={{ json: null, html: '' }} value={{ json: null, html: '' }} onChange={onChange} />
    )

    await waitFor(() => {
      expect(container.querySelector('.ProseMirror')).toBeTruthy()
    })

    const file1 = new File([new Uint8Array([1, 2, 3])], 'a.png', { type: 'image/png' })
    const file2 = new File([new Uint8Array([4, 5, 6])], 'b.png', { type: 'image/png' })

    fireEvent.paste(container.querySelector('.ProseMirror') as Element, {
      clipboardData: {
        files: [file1, file2],
        getData: () => '',
      },
    })

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/assets')
    })

    resolveFirst(jsonResponse({ id: '1', url: '/assets/1' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/assets')
    })

    await waitFor(() => {
      const last = onChange.mock.calls.at(-1)?.[0]
      expect(last?.html).toContain('/assets/1')
      expect(last?.html).toContain('/assets/2')
      expect(String(last?.html).indexOf('/assets/1')).toBeLessThan(String(last?.html).indexOf('/assets/2'))
    })
  })

  it('keeps working after inserting multiple images (regression)', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ id: '1', url: '/assets/1' }))
      .mockResolvedValueOnce(jsonResponse({ id: '2', url: '/assets/2' }))
      .mockResolvedValueOnce(jsonResponse({ id: '3', url: '/assets/3' }))

    const onChange = vi.fn()
    const { container } = render(
      <RichTextEditor initialValue={{ json: null, html: '' }} value={{ json: null, html: '' }} onChange={onChange} />
    )

    await waitFor(() => {
      expect(container.querySelector('.ProseMirror')).toBeTruthy()
    })

    const file1 = new File([new Uint8Array([1])], 'a.png', { type: 'image/png' })
    const file2 = new File([new Uint8Array([2])], 'b.png', { type: 'image/png' })
    const file3 = new File([new Uint8Array([3])], 'c.png', { type: 'image/png' })

    // First paste inserts 2 images.
    fireEvent.paste(container.querySelector('.ProseMirror') as Element, {
      clipboardData: {
        files: [file1, file2],
        getData: () => '',
      },
    })

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    // Second paste should still be able to insert the 3rd image.
    fireEvent.paste(container.querySelector('.ProseMirror') as Element, {
      clipboardData: {
        files: [file3],
        getData: () => '',
      },
    })

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(3)
    })

    await waitFor(() => {
      const last = onChange.mock.calls.at(-1)?.[0]
      expect(String(last?.html || '')).toContain('/assets/1')
      expect(String(last?.html || '')).toContain('/assets/2')
      expect(String(last?.html || '')).toContain('/assets/3')
    })
  })

  it('inserts successful uploads and shows an error when some uploads fail', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ id: '1', url: '/assets/1' }))
      .mockResolvedValueOnce(jsonResponse({ error: 'boom' }, { status: 500 }))
      .mockResolvedValueOnce(jsonResponse({ id: '3', url: '/assets/3' }))

    const onChange = vi.fn()
    const { container } = render(
      <RichTextEditor initialValue={{ json: null, html: '' }} value={{ json: null, html: '' }} onChange={onChange} />
    )

    await waitFor(() => {
      expect(container.querySelector('.ProseMirror')).toBeTruthy()
    })

    const file1 = new File([new Uint8Array([1])], 'a.png', { type: 'image/png' })
    const file2 = new File([new Uint8Array([2])], 'b.png', { type: 'image/png' })
    const file3 = new File([new Uint8Array([3])], 'c.png', { type: 'image/png' })

    fireEvent.paste(container.querySelector('.ProseMirror') as Element, {
      clipboardData: {
        files: [file1, file2, file3],
        getData: () => '',
      },
    })

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(3)
    })

    await waitFor(() => {
      const last = onChange.mock.calls.at(-1)?.[0]
      expect(String(last?.html || '')).toContain('/assets/1')
      expect(String(last?.html || '')).toContain('/assets/3')
      expect(String(last?.html || '')).not.toContain('/assets/2')
      expect(String(last?.html || '').indexOf('/assets/1')).toBeLessThan(String(last?.html || '').indexOf('/assets/3'))
    })

    await waitFor(() => {
      expect(container.textContent).toContain('上传失败')
    })
  })

  it('ignores paste when clipboard has no image files', async () => {
    const onChange = vi.fn()
    const { container } = render(
      <RichTextEditor initialValue={{ json: null, html: '' }} value={{ json: null, html: '' }} onChange={onChange} />
    )

    await waitFor(() => {
      expect(container.querySelector('.ProseMirror')).toBeTruthy()
    })

    const file = new File([new Uint8Array([1, 2, 3])], 'a.txt', { type: 'text/plain' })
    fireEvent.paste(container.querySelector('.ProseMirror') as Element, {
      clipboardData: {
        files: [file],
        getData: () => '',
      },
    })

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(0)
    })
  })
})
