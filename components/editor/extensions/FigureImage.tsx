"use client"

import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { NodeSelection, Plugin } from '@tiptap/pm/state'
import {
  clampInt,
  computeCropVars,
  computeRotatedSizeVars,
  formatDeg,
  normalizeRotate,
  normalizeSrc,
  parseAlign,
  parseBool,
  type FigureImageAttrs,
} from '@/components/editor/extensions/figureImageUtils'
import FigureImageView from '@/components/editor/extensions/FigureImageView'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    figureImage: {
      setFigureImage: (attrs: FigureImageAttrs) => ReturnType
    }
  }
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
      widthPct: {
        default: 100,
        parseHTML: (element) => {
          if (!(element instanceof HTMLElement)) return 100
          const self = element.getAttribute?.('data-width-pct')
          if (self) return clampInt(self, 10, 100, 100)
          const container = element.matches('div')
            ? element
            : element.querySelector('[data-figure-image-container]') || element.querySelector('[data-figure-image-frame]')
          const raw = (container as HTMLElement | null)?.getAttribute?.('data-width-pct')
          return clampInt(raw, 10, 100, 100)
        },
        renderHTML: () => ({}),
      },
      cropL: {
        default: 0,
        parseHTML: (element) => {
          if (element instanceof HTMLImageElement) return clampInt(element.getAttribute('data-crop-l'), 0, 95, 0)
          if (!(element instanceof HTMLElement)) return 0
          const img = element.querySelector('img')
          return clampInt(img?.getAttribute('data-crop-l'), 0, 95, 0)
        },
        renderHTML: () => ({}),
      },
      cropT: {
        default: 0,
        parseHTML: (element) => {
          if (element instanceof HTMLImageElement) return clampInt(element.getAttribute('data-crop-t'), 0, 95, 0)
          if (!(element instanceof HTMLElement)) return 0
          const img = element.querySelector('img')
          return clampInt(img?.getAttribute('data-crop-t'), 0, 95, 0)
        },
        renderHTML: () => ({}),
      },
      cropR: {
        default: 0,
        parseHTML: (element) => {
          if (element instanceof HTMLImageElement) return clampInt(element.getAttribute('data-crop-r'), 0, 95, 0)
          if (!(element instanceof HTMLElement)) return 0
          const img = element.querySelector('img')
          return clampInt(img?.getAttribute('data-crop-r'), 0, 95, 0)
        },
        renderHTML: () => ({}),
      },
      cropB: {
        default: 0,
        parseHTML: (element) => {
          if (element instanceof HTMLImageElement) return clampInt(element.getAttribute('data-crop-b'), 0, 95, 0)
          if (!(element instanceof HTMLElement)) return 0
          const img = element.querySelector('img')
          return clampInt(img?.getAttribute('data-crop-b'), 0, 95, 0)
        },
        renderHTML: () => ({}),
      },
      cropEditing: {
        default: false,
        parseHTML: () => false,
        renderHTML: () => ({}),
      },
      rotate: {
        default: 0,
        parseHTML: (element) => {
          if (element instanceof HTMLImageElement) return normalizeRotate(element.getAttribute('data-rotate'))
          if (!(element instanceof HTMLElement)) return 0
          const img = element.querySelector('img')
          return normalizeRotate(img?.getAttribute('data-rotate'))
        },
        renderHTML: () => ({}),
      },
      flipX: {
        default: false,
        parseHTML: (element) => {
          if (element instanceof HTMLImageElement) return parseBool(element.getAttribute('data-flip-x'))
          if (!(element instanceof HTMLElement)) return false
          const img = element.querySelector('img')
          return parseBool(img?.getAttribute('data-flip-x'))
        },
        renderHTML: () => ({}),
      },
      flipY: {
        default: false,
        parseHTML: (element) => {
          if (element instanceof HTMLImageElement) return parseBool(element.getAttribute('data-flip-y'))
          if (!(element instanceof HTMLElement)) return false
          const img = element.querySelector('img')
          return parseBool(img?.getAttribute('data-flip-y'))
        },
        renderHTML: () => ({}),
      },
      naturalWidth: {
        default: null,
        parseHTML: (element) => {
          if (element instanceof HTMLImageElement) {
            const v = clampInt(element.getAttribute('data-natural-w'), 0, 200000, 0)
            return v > 0 ? v : null
          }
          if (!(element instanceof HTMLElement)) return null
          const img = element.querySelector('img')
          const v = clampInt(img?.getAttribute('data-natural-w'), 0, 200000, 0)
          return v > 0 ? v : null
        },
        renderHTML: () => ({}),
      },
      naturalHeight: {
        default: null,
        parseHTML: (element) => {
          if (element instanceof HTMLImageElement) {
            const v = clampInt(element.getAttribute('data-natural-h'), 0, 200000, 0)
            return v > 0 ? v : null
          }
          if (!(element instanceof HTMLElement)) return null
          const img = element.querySelector('img')
          const v = clampInt(img?.getAttribute('data-natural-h'), 0, 200000, 0)
          return v > 0 ? v : null
        },
        renderHTML: () => ({}),
      },
      caption: {
        default: false,
        parseHTML: () => false,
        renderHTML: () => ({}),
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'figure',
        contentElement: (element) => {
          if (!(element instanceof HTMLElement)) return element as any
          const caption = element.querySelector('figcaption')
          if (caption) return caption
          const doc = element.ownerDocument || document
          return doc.createElement('figcaption')
        },
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

    const widthPct = clampInt((node.attrs as any)?.widthPct, 10, 100, 100)
    const cropL = clampInt((node.attrs as any)?.cropL, 0, 95, 0)
    const cropT = clampInt((node.attrs as any)?.cropT, 0, 95, 0)
    const cropR = clampInt((node.attrs as any)?.cropR, 0, 95, 0)
    const cropB = clampInt((node.attrs as any)?.cropB, 0, 95, 0)
    const cropEnabled = cropL > 0 || cropT > 0 || cropR > 0 || cropB > 0
    const rotate = normalizeRotate((node.attrs as any)?.rotate)
    const flipX = parseBool((node.attrs as any)?.flipX)
    const flipY = parseBool((node.attrs as any)?.flipY)
    const naturalWidth = (() => {
      const v = clampInt((node.attrs as any)?.naturalWidth, 0, 200000, 0)
      return v > 0 ? v : null
    })()
    const naturalHeight = (() => {
      const v = clampInt((node.attrs as any)?.naturalHeight, 0, 200000, 0)
      return v > 0 ? v : null
    })()

    const hasTransforms = cropEnabled || rotate !== 0 || flipX || flipY
    const mode = hasTransforms ? 'transform' : 'plain'

    const figureStyleParts: string[] = [`width:${widthPct}%`]

    const frameStyleParts: string[] = []
    if (mode === 'transform' && naturalWidth && naturalHeight) {
      const fracW = Math.max(1, 100 - cropL - cropR)
      const fracH = Math.max(1, 100 - cropT - cropB)
      const wEff = naturalWidth * fracW
      const hEff = naturalHeight * fracH
      const ratio = rotate === 90 || rotate === 270 ? `${hEff} / ${wEff}` : `${wEff} / ${hEff}`
      frameStyleParts.push(`aspect-ratio:${ratio}`)
    } else if (mode === 'plain' && naturalWidth && naturalHeight) {
      frameStyleParts.push(`aspect-ratio:${naturalWidth} / ${naturalHeight}`)
    }

    const { w, h } = computeRotatedSizeVars({ rotate, naturalWidth, naturalHeight })
    const imgStyleParts = [
      `--seichi-rot:${formatDeg(rotate)}`,
      `--seichi-flip-x:${flipX ? -1 : 1}`,
      `--seichi-flip-y:${flipY ? -1 : 1}`,
      `--seichi-w:${w}`,
      `--seichi-h:${h}`,
    ]
    if (cropEnabled) {
      const cropVars = computeCropVars({ cropL, cropT, cropR, cropB })
      imgStyleParts.push(`--seichi-crop-left:${cropVars.left}`)
      imgStyleParts.push(`--seichi-crop-top:${cropVars.top}`)
      imgStyleParts.push(`--seichi-crop-width:${cropVars.width}`)
      imgStyleParts.push(`--seichi-crop-height:${cropVars.height}`)
    }

    const captionText = String(node.textContent || '').trim()
    const hasCaption = captionText.length > 0

    return [
      'figure',
      mergeAttributes(HTMLAttributes, {
        'data-figure-image': 'true',
        'data-width-pct': String(widthPct),
        style: figureStyleParts.join(';'),
      }),
      [
        'div',
        {
          'data-figure-image-container': 'true',
          'data-width-pct': String(widthPct),
        },
        [
          'div',
          {
            'data-figure-image-frame': 'true',
            'data-mode': mode,
            style: frameStyleParts.join(';'),
          },
          [
            'img',
            {
              src,
              alt,
              width: naturalWidth ?? undefined,
              height: naturalHeight ?? undefined,
              draggable: 'true',
              'data-rotate': String(rotate),
              'data-flip-x': flipX ? '1' : '0',
              'data-flip-y': flipY ? '1' : '0',
              'data-crop-l': cropL ? String(cropL) : undefined,
              'data-crop-t': cropT ? String(cropT) : undefined,
              'data-crop-r': cropR ? String(cropR) : undefined,
              'data-crop-b': cropB ? String(cropB) : undefined,
              'data-natural-w': naturalWidth ? String(naturalWidth) : undefined,
              'data-natural-h': naturalHeight ? String(naturalHeight) : undefined,
              style: imgStyleParts.join(';'),
            },
          ],
        ],
        ...(hasCaption ? [['figcaption', 0]] : []),
      ],
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
          const naturalWidth = clampInt(attrs?.naturalWidth, 0, 200000, 0) || undefined
          const naturalHeight = clampInt(attrs?.naturalHeight, 0, 200000, 0) || undefined
          return chain().insertContent({ type: this.name, attrs: { src, alt, naturalWidth, naturalHeight } }).run()
        },
    }
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          handleDOMEvents: {
            mousedown(view, event) {
              try {
                const target = event.target
                if (!(target instanceof HTMLElement)) return false
                const wrapper = target.closest('.node-figureImage') as HTMLElement | null
                if (!wrapper) return false
                if (wrapper !== target) return false

                let posFromDom = view.posAtDOM(wrapper, 0)
                const resolved = view.state.doc.resolve(posFromDom)
                for (let depth = resolved.depth; depth > 0; depth--) {
                  const node = resolved.node(depth)
                  if (node.type.name !== 'figureImage') continue
                  try {
                    posFromDom = resolved.before(depth)
                    break
                  } catch {}
                }

                const nextSel = NodeSelection.create(view.state.doc, posFromDom)
                if (!view.state.selection.eq(nextSel)) {
                  view.dispatch(view.state.tr.setSelection(nextSel))
                }
                view.focus()
                return true
              } catch {
                return false
              }
            },
          },
        },
      }),
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(FigureImageView, {
      attrs: ({ node }) => {
        const widthPct = clampInt((node.attrs as any)?.widthPct, 10, 100, 100)
        const align = parseAlign((node.attrs as any)?.align)
        const marginY = '0.75rem'
        const gutter = '0.75rem'

        if (align === 'center') {
          return {
            style: [`width:${widthPct}%`, 'display:block', `margin:${marginY} auto`].join(';'),
          }
        }

        if (align === 'right') {
          return {
            style: [`width:${widthPct}%`, 'display:block', `margin:${marginY} 0 ${marginY} auto`].join(';'),
          }
        }

        if (widthPct >= 100) {
          return {
            style: ['width:100%', 'display:inline-block', 'vertical-align:top', `margin:${marginY} 0`].join(';'),
          }
        }

        return {
          style: [
            `width:max(0px, calc(${widthPct}% - ${gutter}))`,
            'display:inline-block',
            'vertical-align:top',
            `margin:${marginY} ${gutter} ${marginY} 0`,
          ].join(';'),
        }
      },
    })
  },
})
