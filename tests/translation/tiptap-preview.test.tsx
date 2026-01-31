import { render, screen, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import TipTapPreview from '@/components/translation/TipTapPreview'
import type { TipTapNode } from '@/lib/translation/tiptap'

// Mock ResizeObserver for TipTap
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe('TipTapPreview', () => {
  afterEach(() => {
    cleanup()
  })

  const mockContent: TipTapNode = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: 'Hello World'
          }
        ]
      }
    ]
  }

  it('renders content in preview mode', () => {
    render(<TipTapPreview content={mockContent} mode="preview" />)
    expect(screen.getByText('Hello World')).toBeDefined()
    // Verify it is not editable (implementation detail, usually contenteditable="false")
    const editor = screen.getByText('Hello World').closest('.ProseMirror')
    expect(editor).toHaveAttribute('contenteditable', 'false')
  })

  it('renders content in edit mode', () => {
    render(<TipTapPreview content={mockContent} mode="edit" />)
    expect(screen.getByText('Hello World')).toBeDefined()
    const editor = screen.getByText('Hello World').closest('.ProseMirror')
    expect(editor).toHaveAttribute('contenteditable', 'true')
  })
})
