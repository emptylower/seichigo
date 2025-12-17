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

  it('adds caption via image toolbar and persists caption html', async () => {
    const onChange = vi.fn()
    const initialHtml = '<figure><img src="/assets/abc123" alt="" /><figcaption></figcaption></figure><p></p>'
    const { container } = render(
      <RichTextEditor initialValue={{ json: null, html: initialHtml }} value={{ json: null, html: initialHtml }} onChange={onChange} />
    )

    await waitFor(() => {
      expect(container.querySelector('.ProseMirror')).toBeTruthy()
      expect(container.querySelector('img')).toBeTruthy()
    })

    // FigureImage keeps a stable contentDOM even when caption is not enabled.
    expect(container.querySelector('figcaption [data-node-view-content]')).toBeTruthy()

    // Caption editor should not exist until user explicitly enables it.
    expect(container.querySelector('[data-figure-caption]')).toBeFalsy()

    // Select image -> image toolbar appears, caption still hidden.
    fireEvent.mouseDown(container.querySelector('img') as Element)

    await waitFor(() => {
      expect(container.querySelector('[data-image-toolbar]')).toBeTruthy()
    })

    expect(container.querySelector('[data-figure-caption]')).toBeFalsy()

    fireEvent.click(container.querySelector('[aria-label="图片图注"]') as Element)

    await waitFor(() => {
      expect(container.querySelector('[data-figure-caption]')).toBeTruthy()
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

  it('removes caption row when it is left empty', async () => {
    const onChange = vi.fn()
    const initialHtml = '<figure><img src="/assets/abc123" alt="" /><figcaption></figcaption></figure><p></p>'
    const { container } = render(
      <RichTextEditor initialValue={{ json: null, html: initialHtml }} value={{ json: null, html: initialHtml }} onChange={onChange} />
    )

    await waitFor(() => {
      expect(container.querySelector('img')).toBeTruthy()
    })

    fireEvent.mouseDown(container.querySelector('img') as Element)

    await waitFor(() => {
      expect(container.querySelector('[data-image-toolbar]')).toBeTruthy()
    })

    fireEvent.click(container.querySelector('[aria-label="图片图注"]') as Element)

    await waitFor(() => {
      expect(container.querySelector('[data-figure-caption]')).toBeTruthy()
    })

    const caption = container.querySelector('[data-figure-caption]') as HTMLElement
    fireEvent.blur(caption)

    await waitFor(() => {
      expect(container.querySelector('[data-figure-caption]')).toBeFalsy()
      const last = onChange.mock.calls.at(-1)?.[0]
      expect(String(last?.html || '')).not.toContain('<figcaption')
    })
  })
})
