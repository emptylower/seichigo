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
      expect(container.querySelector('[data-figure-image-toolbar]')).toBeTruthy()
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

  it('enables crop and persists crop position after dragging', async () => {
    const onChange = vi.fn()
    const initialHtml = '<figure><img src="/assets/abc123" alt="x" /><figcaption></figcaption></figure><p></p>'
    const { container } = render(
      <RichTextEditor initialValue={{ json: null, html: initialHtml }} value={{ json: null, html: initialHtml }} onChange={onChange} />
    )

    await waitFor(() => {
      expect(container.querySelector('img')).toBeTruthy()
    })

    fireEvent.mouseDown(container.querySelector('img') as Element)

    await waitFor(() => {
      expect(container.querySelector('[data-figure-image-toolbar]')).toBeTruthy()
      expect(container.querySelector('[data-figure-image-frame]')).toBeTruthy()
    })

    const frame = container.querySelector('[data-figure-image-frame]') as HTMLElement
    let rect = { width: 600, height: 400 }
    ;(frame as any).getBoundingClientRect = () =>
      ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: rect.width,
        bottom: rect.height,
        width: rect.width,
        height: rect.height,
        toJSON: () => ({}),
      }) as any

    fireEvent.click(container.querySelector('[aria-label="图片裁剪"]') as Element)

    await waitFor(() => {
      const last = onChange.mock.calls.at(-1)?.[0]
      // default crop height = round(400 * 0.7) = 280
      expect(String(last?.html || '')).toContain('data-crop-h="280"')
    })

    rect = { width: 600, height: 280 }

    const img = container.querySelector('img') as HTMLElement
    fireEvent.mouseDown(img, { clientX: 100, clientY: 100 })
    fireEvent.mouseMove(window, { clientX: 200, clientY: 150 })
    fireEvent.mouseUp(window)

    await waitFor(() => {
      const last = onChange.mock.calls.at(-1)?.[0]
      // drag right/down should reduce crop position percentages from 50,50
      expect(String(last?.html || '')).toContain('data-crop-x="33"')
      expect(String(last?.html || '')).toContain('data-crop-y="32"')
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
    })

    const handle = container.querySelector('[aria-label="调整图片宽度"]') as HTMLElement
    fireEvent.mouseDown(handle, { clientX: 800, clientY: 0 })
    fireEvent.mouseMove(window, { clientX: 700, clientY: 0 })
    fireEvent.mouseUp(window)

    await waitFor(() => {
      const last = onChange.mock.calls.at(-1)?.[0]
      expect(String(last?.html || '')).toContain('data-width-pct="88"')
    })
  })
})

