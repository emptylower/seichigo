import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, waitFor } from '@testing-library/react'
import RichTextEditor from '@/components/editor/RichTextEditor'

describe('editor image toolbar regressions', () => {
  it('closes the block menu when selecting an image (avoid text toolbar)', async () => {
    const onChange = vi.fn()
    const initialHtml =
      '<p>hello</p>' + '<figure><img src="/assets/abc123" alt="x" /><figcaption></figcaption></figure>' + '<p></p>'
    const { container } = render(
      <RichTextEditor initialValue={{ json: null, html: initialHtml }} value={{ json: null, html: initialHtml }} onChange={onChange} />
    )

    await waitFor(() => {
      expect(container.querySelector('.ProseMirror')).toBeTruthy()
      expect(container.querySelector('img')).toBeTruthy()
      expect(container.querySelector('p')).toBeTruthy()
    })

    const prose = container.querySelector('.ProseMirror') as HTMLElement
    const para = container.querySelector('p') as HTMLElement

    fireEvent.mouseMove(para, { clientX: 0, clientY: 0 })

    await waitFor(() => {
      expect(container.querySelector('[aria-label="段落菜单"]')).toBeTruthy()
    })

    fireEvent.click(container.querySelector('[aria-label="段落菜单"]') as Element)

    await waitFor(() => {
      expect(container.querySelector('button[title="块样式"]')).toBeTruthy()
    })

    fireEvent.mouseDown(container.querySelector('img') as Element)

    await waitFor(() => {
      expect(container.querySelector('[data-image-toolbar]')).toBeTruthy()
      expect(container.querySelector('button[title="块样式"]')).toBeFalsy()
    })
  })

  it('selects the image when clicking its wrapper (avoid text toolbar)', async () => {
    const onChange = vi.fn()
    const initialHtml =
      '<p>hello</p>' + '<figure><img src="/assets/abc123" alt="x" /><figcaption></figcaption></figure>' + '<p>after</p>'
    const { container } = render(
      <RichTextEditor initialValue={{ json: null, html: initialHtml }} value={{ json: null, html: initialHtml }} onChange={onChange} />
    )

    await waitFor(() => {
      expect(container.querySelector('.ProseMirror')).toBeTruthy()
      expect(container.querySelector('.node-figureImage')).toBeTruthy()
    })

    fireEvent.mouseDown(container.querySelector('.node-figureImage') as Element)

    await waitFor(() => {
      expect(container.querySelector('[data-image-toolbar]')).toBeTruthy()
      expect(container.querySelector('button[title="块样式"]')).toBeFalsy()
    })
  })
})
