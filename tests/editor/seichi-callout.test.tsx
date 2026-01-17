import { describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { SeichiCallout } from '@/components/editor/extensions/SeichiCallout'

describe('editor seichiCallout block', () => {
  it('inserts callout block', () => {
    const editor = new Editor({
      extensions: [StarterKit, SeichiCallout],
      content: '<p>hi</p>',
    })

    const ok = editor.commands.insertSeichiCallout()

    expect(ok).toBe(true)
    expect(editor.getHTML()).toContain('<seichi-callout')
    editor.destroy()
  })

  it('wraps selection into callout', () => {
    const editor = new Editor({
      extensions: [StarterKit, SeichiCallout],
      content: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'a' }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'b' }] },
        ],
      },
    })

    const end = Math.max(1, editor.state.doc.content.size - 1)
    editor.commands.setTextSelection({ from: 1, to: end })
    const ok = editor.commands.wrapInSeichiCallout()

    expect(ok).toBe(true)
    const html = editor.getHTML()
    expect(html).toContain('<seichi-callout')
    expect(html).toContain('a')
    expect(html).toContain('b')
    editor.destroy()
  })

  it('unsets callout when selection is inside', () => {
    const editor = new Editor({
      extensions: [StarterKit, SeichiCallout],
      content: '<p>hi</p>',
    })

    editor.commands.insertSeichiCallout()
    editor.commands.insertContent('hello')
    editor.commands.setTextSelection(2)
    const ok = editor.commands.unsetSeichiCallout()

    expect(ok).toBe(true)
    const html = editor.getHTML()
    expect(html).not.toContain('seichi-callout')
    expect(html).toContain('hello')
    editor.destroy()
  })
})
