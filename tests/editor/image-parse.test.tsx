import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, waitFor } from '@testing-library/react'
import RichTextEditor from '@/components/editor/RichTextEditor'

describe('editor image html parsing', () => {
  it('parses figure without figcaption without crashing', async () => {
    const onChange = vi.fn()
    const initialHtml = '<figure><img src="/assets/abc123" alt="x" /></figure><p></p>'
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
    })
  })
})

