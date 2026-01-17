import { Node } from '@tiptap/core'
import { wrapIn } from '@tiptap/pm/commands'
import { liftTarget } from '@tiptap/pm/transform'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    seichiCallout: {
      insertSeichiCallout: () => ReturnType
      wrapInSeichiCallout: () => ReturnType
      unsetSeichiCallout: () => ReturnType
    }
  }
}

export const SeichiCallout = Node.create({
  name: 'seichiCallout',

  group: 'block',
  content: 'block+',

  parseHTML() {
    return [{ tag: 'seichi-callout' }]
  },

  renderHTML() {
    return ['seichi-callout', 0]
  },

  addCommands() {
    return {
      insertSeichiCallout:
        () =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            content: [{ type: 'paragraph' }],
          })
        },
      wrapInSeichiCallout:
        () =>
        ({ state, dispatch }) => {
          return wrapIn(this.type)(state, dispatch)
        },
      unsetSeichiCallout:
        () =>
        ({ state, dispatch }) => {
          const { $from, $to } = state.selection
          const range = $from.blockRange($to, (node) => node.type === this.type)
          if (!range) return false
          const target = liftTarget(range)
          if (target == null) return false
          if (dispatch) dispatch(state.tr.lift(range, target))
          return true
        },
    }
  },
})
