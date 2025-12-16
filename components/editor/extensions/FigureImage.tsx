"use client"

import { Node, mergeAttributes } from '@tiptap/core'
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'

type FigureImageAttrs = {
  src: string
  alt?: string
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    figureImage: {
      setFigureImage: (attrs: FigureImageAttrs) => ReturnType
    }
  }
}

function normalizeSrc(value: unknown): string | null {
  const src = String(value || '').trim()
  return src ? src : null
}

function FigureImageView({ node, selected, editor, getPos, HTMLAttributes }: NodeViewProps) {
  const src = String((node.attrs as any)?.src || '')
  const alt = String((node.attrs as any)?.alt || '')
  const captionText = String(node.textContent || '').trim()
  const empty = captionText.length === 0
  const hidden = empty && !selected

  const pos = typeof getPos === 'function' ? getPos : null

  return (
    <NodeViewWrapper
      as="figure"
      className={[
        'my-3',
        'rounded-lg',
        selected ? 'ring-2 ring-brand-200' : '',
      ].join(' ')}
      {...HTMLAttributes}
    >
      <img
        src={src}
        alt={alt}
        draggable
        contentEditable={false}
        className="max-w-full rounded-lg"
        onMouseDown={(e) => {
          e.preventDefault()
          if (!editor || !pos) return
          editor.commands.setNodeSelection(pos())
        }}
      />

      <figcaption
        className="mt-2 text-sm text-gray-600"
        hidden={hidden}
        onMouseDown={(e) => {
          if (!editor || !pos) return
          if (!selected || !empty) return
          e.preventDefault()
          editor.chain().setTextSelection(pos() + 1).focus(undefined, { scrollIntoView: false }).run()
        }}
      >
        <NodeViewContent
          as="div"
          data-figure-caption
          data-placeholder="写说明…"
          data-empty={empty ? 'true' : undefined}
          className="outline-none"
        />
      </figcaption>
    </NodeViewWrapper>
  )
}

export const FigureImage = Node.create({
  name: 'figureImage',

  group: 'block',
  content: 'inline*',
  marks: 'bold italic underline strike link',
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      src: {
        default: null,
        parseHTML: (element) => {
          if (element instanceof HTMLImageElement) return normalizeSrc(element.getAttribute('src'))
          if (!(element instanceof HTMLElement)) return null
          const img = element.querySelector('img')
          return normalizeSrc(img?.getAttribute('src'))
        },
        renderHTML: () => ({}),
      },
      alt: {
        default: '',
        parseHTML: (element) => {
          if (element instanceof HTMLImageElement) return element.getAttribute('alt') || ''
          if (!(element instanceof HTMLElement)) return ''
          const img = element.querySelector('img')
          return img?.getAttribute('alt') || ''
        },
        renderHTML: () => ({}),
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'figure',
        contentElement: 'figcaption',
        getAttrs: (element) => {
          if (!(element instanceof HTMLElement)) return false
          const img = element.querySelector('img')
          const src = normalizeSrc(img?.getAttribute('src'))
          if (!src) return false
          const alt = img?.getAttribute('alt') || ''
          return { src, alt }
        },
      },
      {
        tag: 'img[src]',
        getAttrs: (element) => {
          if (!(element instanceof HTMLImageElement)) return false
          const src = normalizeSrc(element.getAttribute('src'))
          if (!src) return false
          const alt = element.getAttribute('alt') || ''
          return { src, alt }
        },
      },
    ]
  },

  renderHTML({ node, HTMLAttributes }) {
    const src = normalizeSrc((node.attrs as any)?.src)
    const alt = String((node.attrs as any)?.alt || '')
    if (!src) return ['p', 0]

    return [
      'figure',
      mergeAttributes(HTMLAttributes),
      ['img', { src, alt, draggable: 'true' }],
      ['figcaption', 0],
    ]
  },

  addCommands() {
    return {
      setFigureImage:
        (attrs) =>
        ({ chain }) => {
          const src = normalizeSrc(attrs?.src)
          if (!src) return false
          const alt = String(attrs?.alt || '')
          return chain().insertContent({ type: this.name, attrs: { src, alt } }).run()
        },
    }
  },

  addNodeView() {
    return ReactNodeViewRenderer(FigureImageView)
  },
})
