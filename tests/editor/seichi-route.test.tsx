import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, waitFor } from '@testing-library/react'
import RichTextEditor from '@/components/editor/RichTextEditor'

describe('editor seichiRoute block', () => {
  it('renders route preview (svg + table)', async () => {
    const onChange = vi.fn()
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'hi' }] },
        { type: 'seichiRoute', attrs: { id: 'r1', data: { version: 1, spots: [{ name_zh: 'A' }, { name_zh: 'B' }] } } },
        { type: 'paragraph', content: [{ type: 'text', text: 'after' }] },
      ],
    }

    const { container } = render(<RichTextEditor initialValue={{ json: doc, html: '' }} value={{ json: doc, html: '' }} onChange={onChange} />)

    await waitFor(() => {
      expect(container.querySelector('.ProseMirror')).toBeTruthy()
    })

    await waitFor(() => {
      expect(container.querySelector('.seichi-route')).toBeTruthy()
      expect(container.querySelector('.seichi-route svg')).toBeTruthy()
      expect(container.querySelector('.seichi-route table')).toBeTruthy()
    })
  })

  it('edits route JSON via modal and updates doc', async () => {
    const onChange = vi.fn()
    const doc = {
      type: 'doc',
      content: [{ type: 'seichiRoute', attrs: { id: 'r1', data: { version: 1, spots: [{ name_zh: 'A' }, { name_zh: 'B' }] } } }],
    }

    const { container, getByText, getByRole } = render(
      <RichTextEditor initialValue={{ json: doc, html: '' }} value={{ json: doc, html: '' }} onChange={onChange} />
    )

    await waitFor(() => {
      expect(container.querySelector('.ProseMirror')).toBeTruthy()
      expect(container.querySelector('.seichi-route')).toBeTruthy()
    })

    fireEvent.click(getByText('编辑 JSON'))

    const textarea = getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(textarea, {
      target: {
        value: JSON.stringify({ version: 1, spots: [{ name_zh: 'C' }, { name_zh: 'D' }, { name_zh: 'E' }] }, null, 2),
      },
    })
    fireEvent.click(getByText('保存'))

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled()
      const last = onChange.mock.calls[onChange.mock.calls.length - 1]?.[0]
      expect(JSON.stringify(last?.json || {})).toContain('C')
      expect(JSON.stringify(last?.json || {})).toContain('E')
    })
  })
})

