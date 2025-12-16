import React from 'react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, waitFor } from '@testing-library/react'
import RichTextEditor from '@/components/editor/RichTextEditor'

describe('editor image caption', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.unstubAllGlobals()
    vi.stubGlobal('fetch', fetchMock as any)
  })

  it('shows caption editor when image is selected and persists caption html', async () => {
    const onChange = vi.fn()
    const initialHtml = '<figure><img src="/assets/abc123" alt="" /><figcaption></figcaption></figure><p></p>'
    const { container } = render(
      <RichTextEditor initialValue={{ json: null, html: initialHtml }} value={{ json: null, html: initialHtml }} onChange={onChange} />
    )

    await waitFor(() => {
      expect(container.querySelector('.ProseMirror')).toBeTruthy()
      expect(container.querySelector('img')).toBeTruthy()
    })

    // Caption editor should be hidden when empty and not selected.
    const captionEditor = container.querySelector('[data-figure-caption]') as HTMLElement | null
    expect(captionEditor).toBeTruthy()
    expect(captionEditor?.closest('figcaption')?.hasAttribute('hidden')).toBe(true)

    // Select image -> caption editor appears.
    fireEvent.mouseDown(container.querySelector('img') as Element)
    fireEvent.click(container.querySelector('img') as Element)

    await waitFor(() => {
      expect(container.querySelector('[data-figure-caption]')?.closest('figcaption')?.hasAttribute('hidden')).toBe(false)
    })

    // Paste caption text (should not trigger url-preview handler).
    const caption = container.querySelector('[data-figure-caption]') as Element
    fireEvent.mouseDown(caption)
    fireEvent.paste(caption, {
      clipboardData: {
        files: [],
        getData: (t: string) => (t === 'text/plain' ? '图 1：测试图注' : ''),
      },
    })

    await waitFor(() => {
      const last = onChange.mock.calls.at(-1)?.[0]
      expect(String(last?.html || '')).toContain('图 1：测试图注')
      expect(String(last?.html || '')).toContain('<figcaption')
    })
  })
})
