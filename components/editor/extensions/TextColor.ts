import { Mark, mergeAttributes } from '@tiptap/core'
import { readColorFromStyle, readStyleAttr } from './colorUtils'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    textColor: {
      setTextColor: (color: string) => ReturnType
      unsetTextColor: () => ReturnType
    }
  }
}

export const TextColor = Mark.create({
  name: 'textColor',

  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: (element) => readColorFromStyle(readStyleAttr(element)),
        renderHTML: (attributes) => {
          const color = String(attributes.color || '').trim()
          if (!color) return {}
          return { style: `color:${color}` }
        },
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'span',
        getAttrs: (element) => {
          if (!(element instanceof HTMLElement)) return false
          const color = readColorFromStyle(readStyleAttr(element))
          if (!color) return false
          return { color }
        },
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes), 0]
  },

  addCommands() {
    return {
      setTextColor:
        (color) =>
        ({ chain }) => {
          const trimmed = color.trim()
          if (!trimmed) return false
          return chain().setMark(this.name, { color: trimmed }).run()
        },
      unsetTextColor:
        () =>
        ({ chain }) => {
          return chain().unsetMark(this.name).run()
        },
    }
  },
})

