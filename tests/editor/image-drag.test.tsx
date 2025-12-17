import React from 'react'
import { describe, expect, it } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import RichTextEditor from '@/components/editor/RichTextEditor'

describe('editor image drag behavior', () => {
  it('marks the image body as a drag handle', async () => {
    const onChange = () => {}
    const initialHtml = '<figure><img src="/assets/abc123" alt="x" /><figcaption></figcaption></figure><p></p>'
    const { container } = render(
      <RichTextEditor initialValue={{ json: null, html: initialHtml }} value={{ json: null, html: initialHtml }} onChange={onChange} />
    )

    await waitFor(() => {
      expect(container.querySelector('img')).toBeTruthy()
    })

    const img = container.querySelector('img') as HTMLElement
    expect(img).toHaveAttribute('data-drag-handle')

    const wrapper = container.querySelector('.node-figureImage') as HTMLElement | null
    expect(wrapper).toBeTruthy()
    expect(wrapper?.getAttribute('style') || '').toContain('display:inline-block')
  })
})

