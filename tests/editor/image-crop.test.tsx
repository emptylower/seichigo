import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, waitFor } from '@testing-library/react'
import RichTextEditor from '@/components/editor/RichTextEditor'

function rect({ width, height, left = 0, top = 0 }: { width: number; height: number; left?: number; top?: number }) {
  return {
    x: left,
    y: top,
    top,
    left,
    right: left + width,
    bottom: top + height,
    width,
    height,
    toJSON: () => ({}),
  } as any
}

describe('editor image crop', () => {
  it('enters crop mode and updates crop insets via handles', async () => {
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
      expect(container.querySelector('[data-image-toolbar]')).toBeTruthy()
    })

    fireEvent.click(container.querySelector('[aria-label="图片裁剪"]') as Element)

    await waitFor(() => {
      expect(container.querySelector('[data-image-crop-overlay]')).toBeTruthy()
      expect(container.querySelector('[data-image-crop-handle="se"]')).toBeTruthy()
    })

    const frame = container.querySelector('[data-figure-image-frame]') as HTMLElement
    ;(frame as any).getBoundingClientRect = () => rect({ width: 1000, height: 500 })

    const handle = container.querySelector('[data-image-crop-handle="se"]') as HTMLElement
    fireEvent.mouseDown(handle, { clientX: 1000, clientY: 500 })
    fireEvent.mouseMove(window, { clientX: 900, clientY: 450 })
    fireEvent.mouseUp(window)

    await waitFor(() => {
      const last = onChange.mock.calls.at(-1)?.[0]
      const html = String(last?.html || '')
      expect(html).toContain('data-crop-r="10"')
      expect(html).toContain('data-crop-b="10"')
    })
  })

  it('esc cancels crop changes and exits crop mode', async () => {
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
      expect(container.querySelector('[data-image-toolbar]')).toBeTruthy()
    })

    fireEvent.click(container.querySelector('[aria-label="图片裁剪"]') as Element)
    await waitFor(() => {
      expect(container.querySelector('[data-image-crop-overlay]')).toBeTruthy()
    })

    const frame = container.querySelector('[data-figure-image-frame]') as HTMLElement
    ;(frame as any).getBoundingClientRect = () => rect({ width: 1000, height: 500 })

    const handle = container.querySelector('[data-image-crop-handle="se"]') as HTMLElement
    fireEvent.mouseDown(handle, { clientX: 1000, clientY: 500 })
    fireEvent.mouseMove(window, { clientX: 900, clientY: 450 })
    fireEvent.mouseUp(window)

    await waitFor(() => {
      const last = onChange.mock.calls.at(-1)?.[0]
      expect(String(last?.html || '')).toContain('data-crop-r="10"')
    })

    fireEvent.keyDown(container.querySelector('.ProseMirror') as Element, { key: 'Escape' })

    await waitFor(() => {
      expect(container.querySelector('[data-image-crop-overlay]')).toBeFalsy()
      const last = onChange.mock.calls.at(-1)?.[0]
      const html = String(last?.html || '')
      expect(html).not.toContain('data-crop-l=')
      expect(html).not.toContain('data-crop-t=')
      expect(html).not.toContain('data-crop-r=')
      expect(html).not.toContain('data-crop-b=')
    })
  })

  it('enter confirms crop changes and exits crop mode', async () => {
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
      expect(container.querySelector('[data-image-toolbar]')).toBeTruthy()
    })

    fireEvent.click(container.querySelector('[aria-label="图片裁剪"]') as Element)
    await waitFor(() => {
      expect(container.querySelector('[data-image-crop-overlay]')).toBeTruthy()
    })

    const frame = container.querySelector('[data-figure-image-frame]') as HTMLElement
    ;(frame as any).getBoundingClientRect = () => rect({ width: 1000, height: 500 })

    const handle = container.querySelector('[data-image-crop-handle="se"]') as HTMLElement
    fireEvent.mouseDown(handle, { clientX: 1000, clientY: 500 })
    fireEvent.mouseMove(window, { clientX: 900, clientY: 450 })
    fireEvent.mouseUp(window)

    await waitFor(() => {
      const last = onChange.mock.calls.at(-1)?.[0]
      expect(String(last?.html || '')).toContain('data-crop-r="10"')
    })

    fireEvent.keyDown(container.querySelector('.ProseMirror') as Element, { key: 'Enter' })

    await waitFor(() => {
      expect(container.querySelector('[data-image-crop-overlay]')).toBeFalsy()
      const last = onChange.mock.calls.at(-1)?.[0]
      const html = String(last?.html || '')
      expect(html).toContain('data-crop-r="10"')
      expect(html).toContain('data-crop-b="10"')

      const img = container.querySelector('img') as HTMLImageElement | null
      expect(img).toBeTruthy()
      expect(img?.style.objectFit).toBe('cover')
      expect(img?.style.transform).not.toContain('translate')
    })
  })
})
