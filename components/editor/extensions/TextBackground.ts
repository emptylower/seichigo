import { Mark, mergeAttributes } from '@tiptap/core'
import { readBackgroundFromStyle, readStyleAttr } from './colorUtils'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    textBackground: {
      setTextBackground: (color: string) => ReturnType
      unsetTextBackground: () => ReturnType
    }
  }
}

export const TextBackground = Mark.create({
  name: 'textBackground',

  addAttributes() {
    return {
      backgroundColor: {
        default: null,
        parseHTML: (element) => readBackgroundFromStyle(readStyleAttr(element)),
        renderHTML: (attributes) => {
          const color = String(attributes.backgroundColor || '').trim()
          if (!color) return {}
          return { style: `background-color:${color}` }
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
          const backgroundColor = readBackgroundFromStyle(readStyleAttr(element))
          if (!backgroundColor) return false
          return { backgroundColor }
        },
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes), 0]
  },

  addCommands() {
    return {
      setTextBackground:
        (color) =>
        ({ chain }) => {
          const trimmed = color.trim()
          if (!trimmed) return false
          return chain().setMark(this.name, { backgroundColor: trimmed }).run()
        },
      unsetTextBackground:
        () =>
        ({ chain }) => {
          return chain().unsetMark(this.name).run()
        },
    }
  },
})

