import { Extension } from '@tiptap/core'

export type BlockAlign = 'left' | 'center' | 'right'

const MAX_INDENT_LEVEL = 6

type Options = {
  alignTypes: string[]
  indentTypes: string[]
}

function clampIndent(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(MAX_INDENT_LEVEL, Math.trunc(n)))
}

function parseAlign(value: string | null): BlockAlign | null {
  if (!value) return null
  const v = value.trim().toLowerCase()
  if (v === 'center' || v === 'right') return v
  return null
}

function parseIndent(value: string | null): number {
  if (!value) return 0
  if (!/^\d+$/.test(value.trim())) return 0
  return clampIndent(Number(value.trim()))
}

function collectTopLevelBlockPositions(state: any, types: Set<string>): number[] {
  const { from, to } = state.selection
  const doc = state.doc

  if (from === to) {
    const $pos = doc.resolve(from)
    if ($pos.depth < 1) return []
    const node = $pos.node(1)
    if (!types.has(node.type.name)) return []
    return [$pos.before(1)]
  }

  const positions: number[] = []
  doc.nodesBetween(from, to, (node: any, pos: number, parent: any) => {
    if (!parent || parent.type?.name !== 'doc') return
    if (!types.has(node.type.name)) return
    positions.push(pos)
  })
  return positions
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    blockLayout: {
      setBlockAlign: (align: BlockAlign) => ReturnType
      increaseBlockIndent: () => ReturnType
      decreaseBlockIndent: () => ReturnType
    }
  }
}

export const BlockLayout = Extension.create<Options>({
  name: 'blockLayout',

  addOptions() {
    return {
      alignTypes: ['paragraph', 'heading', 'blockquote', 'codeBlock', 'bulletList', 'orderedList', 'image'],
      indentTypes: ['paragraph', 'heading', 'blockquote', 'codeBlock', 'image'],
    }
  },

  addGlobalAttributes() {
    return [
      {
        types: Array.from(new Set([...this.options.alignTypes, ...this.options.indentTypes])),
        attributes: {
          align: {
            default: null,
            parseHTML: (element) => parseAlign(element.getAttribute('data-align')),
            renderHTML: (attributes) => {
              const align = parseAlign(String(attributes.align ?? '')) ?? null
              if (!align) return {}
              return { 'data-align': align }
            },
          },
          indent: {
            default: 0,
            parseHTML: (element) => parseIndent(element.getAttribute('data-indent')),
            renderHTML: (attributes) => {
              const indent = clampIndent(attributes.indent)
              if (!indent) return {}
              return { 'data-indent': String(indent) }
            },
          },
        },
      },
    ]
  },

  addCommands() {
    return {
      setBlockAlign:
        (align) =>
        ({ state, dispatch }) => {
          const types = new Set(this.options.alignTypes)
          const positions = collectTopLevelBlockPositions(state, types)
          if (!positions.length) return false

          const normalized: BlockAlign | null = align === 'left' ? null : align
          let tr = state.tr
          let changed = false

          for (const pos of positions) {
            const node = state.doc.nodeAt(pos)
            if (!node) continue
            const current = parseAlign(String(node.attrs.align ?? '')) ?? null
            if (current === normalized) continue
            tr = tr.setNodeMarkup(pos, undefined, { ...node.attrs, align: normalized })
            changed = true
          }

          if (!changed) return false
          if (dispatch) dispatch(tr)
          return true
        },

      increaseBlockIndent:
        () =>
        ({ commands, state, dispatch }) => {
          if (commands.sinkListItem?.('listItem')) return true

          const types = new Set(this.options.indentTypes)
          const positions = collectTopLevelBlockPositions(state, types)
          if (!positions.length) return false

          let tr = state.tr
          let changed = false

          for (const pos of positions) {
            const node = state.doc.nodeAt(pos)
            if (!node) continue
            const current = clampIndent(node.attrs.indent)
            const next = clampIndent(current + 1)
            if (next === current) continue
            tr = tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: next })
            changed = true
          }

          if (!changed) return false
          if (dispatch) dispatch(tr)
          return true
        },

      decreaseBlockIndent:
        () =>
        ({ commands, state, dispatch }) => {
          if (commands.liftListItem?.('listItem')) return true

          const types = new Set(this.options.indentTypes)
          const positions = collectTopLevelBlockPositions(state, types)
          if (!positions.length) return false

          let tr = state.tr
          let changed = false

          for (const pos of positions) {
            const node = state.doc.nodeAt(pos)
            if (!node) continue
            const current = clampIndent(node.attrs.indent)
            const next = clampIndent(current - 1)
            if (next === current) continue
            tr = tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: next })
            changed = true
          }

          if (!changed) return false
          if (dispatch) dispatch(tr)
          return true
        },
    }
  },
})

