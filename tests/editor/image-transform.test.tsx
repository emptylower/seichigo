import React from 'react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, waitFor } from '@testing-library/react'
import RichTextEditor from '@/components/editor/RichTextEditor'

describe('editor image transform tools', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows image toolbar and updates align/rotate/flip', async () => {
    const onChange = vi.fn()
    const initialHtml = '<figure><img src="/assets/abc123" alt="x" /><figcaption></figcaption></figure><p></p>'
    const { container } = render(
      <RichTextEditor initialValue={{ json: null, html: initialHtml }} value={{ json: null, html: initialHtml }} onChange={onChange} />
    )

    await waitFor(() => {
      expect(container.querySelector('.ProseMirror')).toBeTruthy()
      expect(container.querySelector('img')).toBeTruthy()
    })

    fireEvent.mouseDown(container.querySelector('img') as Element)

    await waitFor(() => {
      expect(container.querySelector('[data-image-toolbar]')).toBeTruthy()
      expect(container.querySelector('[data-figure-image-container]')).toBeTruthy()
    })

    fireEvent.click(container.querySelector('[aria-label="图片居中对齐"]') as Element)
    await waitFor(() => {
      const last = onChange.mock.calls.at(-1)?.[0]
      expect(String(last?.html || '')).toContain('data-align="center"')
    })

    fireEvent.click(container.querySelector('[aria-label="图片旋转 90°"]') as Element)
    await waitFor(() => {
      const last = onChange.mock.calls.at(-1)?.[0]
      expect(String(last?.html || '')).toContain('data-rotate="90"')
    })

    fireEvent.click(container.querySelector('[aria-label="图片水平翻转"]') as Element)
    await waitFor(() => {
      const last = onChange.mock.calls.at(-1)?.[0]
      expect(String(last?.html || '')).toContain('data-flip-x="1"')
    })
  })

  it('resizes image via handle and persists width percent', async () => {
    const onChange = vi.fn()
    const initialHtml = '<figure><img src="/assets/abc123" alt="x" /><figcaption></figcaption></figure><p></p>'
    const { container } = render(
      <RichTextEditor initialValue={{ json: null, html: initialHtml }} value={{ json: null, html: initialHtml }} onChange={onChange} />
    )

    await waitFor(() => {
      expect(container.querySelector('img')).toBeTruthy()
    })

    const figure = container.querySelector('figure') as HTMLElement
    ;(figure as any).getBoundingClientRect = () =>
      ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 800,
        bottom: 600,
        width: 800,
        height: 600,
        toJSON: () => ({}),
      }) as any

    fireEvent.mouseDown(container.querySelector('img') as Element)

    await waitFor(() => {
      expect(container.querySelector('[aria-label="调整图片宽度"]')).toBeTruthy()
      expect(container.querySelector('[data-figure-image-container]')).toBeTruthy()
    })

    const handle = container.querySelector('[aria-label="调整图片宽度"]') as HTMLElement
    fireEvent.mouseDown(handle, { clientX: 800, clientY: 0 })
    fireEvent.mouseMove(window, { clientX: 700, clientY: 0 })
    fireEvent.mouseUp(window)

    await waitFor(() => {
      const last = onChange.mock.calls.at(-1)?.[0]
      expect(String(last?.html || '')).toContain('data-width-pct="88"')
      expect(String(last?.html || '')).toContain('data-figure-image="true"')
      expect(String(last?.html || '')).toMatch(/<figure[^>]*style="[^"]*width:\s*88%/i)
      expect(String(last?.html || '')).toContain('data-figure-image-container="true"')
    })
  })
})
