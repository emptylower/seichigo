import { describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { InlineCode } from '@/components/editor/extensions/InlineCode'
import { TextBackground } from '@/components/editor/extensions/TextBackground'
import { TextColor } from '@/components/editor/extensions/TextColor'

describe('editor inline code + link', () => {
  it('allows links on inline-code text', () => {
    const editor = new Editor({
      extensions: [
        StarterKit.configure({
          code: false,
          link: {
            openOnClick: false,
            autolink: false,
            linkOnPaste: true,
          },
        }),
        InlineCode,
        TextColor,
        TextBackground,
      ],
      content: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'hello',
                marks: [{ type: 'code' }],
              },
            ],
          },
        ],
      },
    })

    editor.commands.setTextSelection({ from: 1, to: 6 })
    const ok = editor.commands.setLink({ href: 'https://example.com' })

    expect(ok).toBe(true)
    const html = editor.getHTML()
    expect(html).toContain('href="https://example.com"')
    expect(html).toContain('<code')

    editor.destroy()
  })
})
