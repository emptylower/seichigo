"use client"

import { useCallback, useEffect, useMemo, useRef, type MouseEvent as ReactMouseEvent } from 'react'
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

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (value == null) return fallback
  if (typeof value === 'string' && value.trim() === '') return fallback
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.trunc(n)))
}

function normalizeRotate(value: unknown): number {
  const n = clampInt(value, 0, 360, 0)
  const normalized = ((n % 360) + 360) % 360
  if (normalized === 90 || normalized === 180 || normalized === 270) return normalized
  return 0
}

function parseBool(value: unknown): boolean {
  if (value === true) return true
  if (value === false) return false
  const v = String(value ?? '').trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes'
}

function formatPct(value: number): string {
  return `${Math.round(value)}%`
}

function formatDeg(value: number): string {
  return `${normalizeRotate(value)}deg`
}

function computeRotatedSizeVars(opts: { rotate: number; crop: boolean; naturalWidth: number | null; naturalHeight: number | null }) {
  if (opts.crop) return { w: '100%', h: '100%' }
  if (opts.rotate !== 90 && opts.rotate !== 270) return { w: '100%', h: '100%' }
  const nw = opts.naturalWidth ?? null
  const nh = opts.naturalHeight ?? null
  if (!nw || !nh) return { w: '100%', h: '100%' }
  const ar = nw / nh
  if (!Number.isFinite(ar) || ar <= 0) return { w: '100%', h: '100%' }
  const w = `${Math.round(ar * 100)}%`
  const h = `${Math.round((1 / ar) * 100)}%`
  return { w, h }
}

function FigureImageView({ node, selected, editor, getPos, updateAttributes, HTMLAttributes }: NodeViewProps) {
  const src = String((node.attrs as any)?.src || '')
  const alt = String((node.attrs as any)?.alt || '')

  const widthPct = clampInt((node.attrs as any)?.widthPct, 10, 100, 100)
  const cropHeightRaw = (node.attrs as any)?.cropHeight
  const cropHeight = cropHeightRaw == null ? null : clampInt(cropHeightRaw, 80, 2400, 320)
  const cropX = clampInt((node.attrs as any)?.cropX, 0, 100, 50)
  const cropY = clampInt((node.attrs as any)?.cropY, 0, 100, 50)
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

  const cropEnabled = cropHeight != null
  const hasTransforms = cropEnabled || rotate !== 0 || flipX || flipY
  const mode: 'plain' | 'transform' = hasTransforms ? 'transform' : 'plain'

  const captionText = String(node.textContent || '').trim()
  const empty = captionText.length === 0
  const hidden = empty && !selected

  const pos = typeof getPos === 'function' ? getPos : null
  const figureRef = useRef<HTMLElement | null>(null)
  const frameRef = useRef<HTMLDivElement | null>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)

  const setNodeSelection = useCallback(() => {
    if (!editor || !pos) return
    const at = pos()
    if (typeof at !== 'number') return
    editor.commands.setNodeSelection(at)
  }, [editor, pos])

  const frameStyle = useMemo(() => {
    const style: Record<string, string> = { width: `${widthPct}%` }
    if (cropEnabled && cropHeight) {
      style.height = `${cropHeight}px`
      return style
    }
    if (mode === 'transform' && naturalWidth && naturalHeight) {
      const ratio = rotate === 90 || rotate === 270 ? `${naturalHeight} / ${naturalWidth}` : `${naturalWidth} / ${naturalHeight}`
      style['aspect-ratio'] = ratio
    }
    return style
  }, [cropEnabled, cropHeight, mode, naturalHeight, naturalWidth, rotate, widthPct])

  const imgVars = useMemo(() => {
    const { w, h } = computeRotatedSizeVars({ rotate, crop: cropEnabled, naturalWidth, naturalHeight })
    return {
      '--seichi-rot': formatDeg(rotate),
      '--seichi-flip-x': String(flipX ? -1 : 1),
      '--seichi-flip-y': String(flipY ? -1 : 1),
      '--seichi-w': w,
      '--seichi-h': h,
      '--seichi-pos': `${formatPct(cropX)} ${formatPct(cropY)}`,
    } as any
  }, [cropEnabled, cropX, cropY, flipX, flipY, naturalHeight, naturalWidth, rotate])

  const dragState = useRef<
    | { type: 'crop'; startX: number; startY: number; startCropX: number; startCropY: number; rectW: number; rectH: number }
    | { type: 'resize'; startX: number; startWidthPct: number; containerW: number }
    | null
  >(null)

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const state = dragState.current
      if (!state) return

      if (state.type === 'crop') {
        const dx = e.clientX - state.startX
        const dy = e.clientY - state.startY
        const rectW = state.rectW || 1
        const rectH = state.rectH || 1
        const nextX = clampInt(Math.round(state.startCropX + (-dx / rectW) * 100), 0, 100, state.startCropX)
        const nextY = clampInt(Math.round(state.startCropY + (-dy / rectH) * 100), 0, 100, state.startCropY)
        updateAttributes({ cropX: nextX, cropY: nextY })
        return
      }

      if (state.type === 'resize') {
        const dx = e.clientX - state.startX
        const containerW = state.containerW || 1
        const next = clampInt(Math.round(state.startWidthPct + (dx / containerW) * 100), 10, 100, state.startWidthPct)
        updateAttributes({ widthPct: next })
      }
    }

    const onUp = () => {
      dragState.current = null
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [updateAttributes])

  const startCropDrag = useCallback(
    (e: ReactMouseEvent) => {
      if (!cropEnabled) return
      const frame = frameRef.current
      if (!frame) return
      const rect = frame.getBoundingClientRect()
      dragState.current = {
        type: 'crop',
        startX: e.clientX,
        startY: e.clientY,
        startCropX: cropX,
        startCropY: cropY,
        rectW: rect.width || 1,
        rectH: rect.height || 1,
      }
    },
    [cropEnabled, cropX, cropY]
  )

  const startResizeDrag = useCallback(
    (e: ReactMouseEvent) => {
      const figure = figureRef.current
      const rect = figure?.getBoundingClientRect()
      const containerW = rect?.width || 800
      dragState.current = { type: 'resize', startX: e.clientX, startWidthPct: widthPct, containerW }
    },
    [widthPct]
  )

  const toggleCrop = useCallback(() => {
    if (cropEnabled) {
      updateAttributes({ cropHeight: null })
      setNodeSelection()
      return
    }

    const frame = frameRef.current
    const rect = frame?.getBoundingClientRect()
    const baseHeight = rect?.height || 0
    const suggested = baseHeight > 0 ? Math.round(baseHeight * 0.7) : 320
    const nextHeight = clampInt(suggested, 120, 2400, 320)
    updateAttributes({ cropHeight: nextHeight, cropX: cropX ?? 50, cropY: cropY ?? 50 })
    setNodeSelection()
  }, [cropEnabled, cropX, cropY, setNodeSelection, updateAttributes])

  const rotate90 = useCallback(() => {
    const next = (rotate + 90) % 360
    updateAttributes({ rotate: next })
    setNodeSelection()
  }, [rotate, setNodeSelection, updateAttributes])

  const toggleFlipX = useCallback(() => {
    updateAttributes({ flipX: !flipX })
    setNodeSelection()
  }, [flipX, setNodeSelection, updateAttributes])

  const toggleFlipY = useCallback(() => {
    updateAttributes({ flipY: !flipY })
    setNodeSelection()
  }, [flipY, setNodeSelection, updateAttributes])

  const setAlign = useCallback(
    (value: 'left' | 'center' | 'right') => {
      const next = value === 'left' ? null : value
      updateAttributes({ align: next })
      setNodeSelection()
    },
    [setNodeSelection, updateAttributes]
  )

  useEffect(() => {
    if (naturalWidth && naturalHeight) return
    const img = imgRef.current
    if (!img) return
    const apply = () => {
      const nw = img.naturalWidth || 0
      const nh = img.naturalHeight || 0
      if (!nw || !nh) return
      updateAttributes({ naturalWidth: nw, naturalHeight: nh })
    }
    if (img.complete) apply()
    else {
      img.addEventListener('load', apply, { once: true })
      return () => {
        img.removeEventListener('load', apply)
      }
    }
  }, [naturalHeight, naturalWidth, updateAttributes])

  return (
    <NodeViewWrapper
      as="figure"
      ref={(el: HTMLElement | null) => {
        figureRef.current = el
      }}
      className={[
        'my-3',
        'rounded-lg',
        selected ? 'ring-2 ring-brand-200' : '',
      ].join(' ')}
      {...HTMLAttributes}
    >
      <div
        ref={frameRef}
        data-figure-image-frame
        data-mode={mode}
        data-width-pct={String(widthPct)}
        data-crop-h={cropEnabled && cropHeight ? String(cropHeight) : undefined}
        style={frameStyle as any}
        className="relative inline-block max-w-full"
      >
        <img
          ref={imgRef}
          src={src}
          alt={alt}
          draggable
          contentEditable={false}
          data-rotate={String(rotate)}
          data-flip-x={flipX ? '1' : '0'}
          data-flip-y={flipY ? '1' : '0'}
          data-crop-x={String(cropX)}
          data-crop-y={String(cropY)}
          data-natural-w={naturalWidth ? String(naturalWidth) : undefined}
          data-natural-h={naturalHeight ? String(naturalHeight) : undefined}
          style={imgVars}
          className={[
            mode === 'transform' ? 'absolute left-1/2 top-1/2 max-w-none' : 'block h-auto w-full',
            'rounded-lg',
          ].join(' ')}
          onMouseDown={(e) => {
            e.preventDefault()
            e.stopPropagation()
            setNodeSelection()
            startCropDrag(e)
          }}
        />

        {selected ? (
          <>
            <div
              data-figure-image-toolbar
              className="absolute left-2 top-2 flex items-center gap-1 rounded-md border border-gray-200 bg-white/95 px-2 py-1 text-xs text-gray-700 shadow-sm backdrop-blur"
              onMouseDown={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setNodeSelection()
              }}
            >
              <button type="button" className="px-1.5 py-0.5 hover:text-gray-900" aria-label="图片左对齐" onClick={() => setAlign('left')}>
                左
              </button>
              <button type="button" className="px-1.5 py-0.5 hover:text-gray-900" aria-label="图片居中对齐" onClick={() => setAlign('center')}>
                中
              </button>
              <button type="button" className="px-1.5 py-0.5 hover:text-gray-900" aria-label="图片右对齐" onClick={() => setAlign('right')}>
                右
              </button>
              <span className="mx-1 h-3 w-px bg-gray-200" />
              <button
                type="button"
                className="px-1.5 py-0.5 hover:text-gray-900"
                aria-label="图片裁剪"
                onClick={toggleCrop}
                title={cropEnabled ? '取消裁剪' : '裁剪'}
              >
                {cropEnabled ? '取消裁剪' : '裁剪'}
              </button>
              <button type="button" className="px-1.5 py-0.5 hover:text-gray-900" aria-label="图片旋转 90°" onClick={rotate90}>
                旋转
              </button>
              <button type="button" className="px-1.5 py-0.5 hover:text-gray-900" aria-label="图片水平翻转" onClick={toggleFlipX}>
                翻转X
              </button>
              <button type="button" className="px-1.5 py-0.5 hover:text-gray-900" aria-label="图片垂直翻转" onClick={toggleFlipY}>
                翻转Y
              </button>
            </div>

            <button
              type="button"
              aria-label="调整图片宽度"
              className="absolute -right-2 top-1/2 h-4 w-4 -translate-y-1/2 rounded-full border border-gray-300 bg-white shadow-sm"
              onMouseDown={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setNodeSelection()
                startResizeDrag(e)
              }}
            />
          </>
        ) : null}
      </div>

      <figcaption
        className="mt-2 text-sm text-gray-600"
        hidden={hidden}
        onMouseDown={(e) => {
          if (!editor || !pos) return
          if (!selected || !empty) return
          e.preventDefault()
          const at = pos()
          if (typeof at !== 'number') return
          editor.chain().setTextSelection(at + 1).focus(undefined, { scrollIntoView: false }).run()
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
      widthPct: {
        default: 100,
        parseHTML: (element) => {
          if (!(element instanceof HTMLElement)) return 100
          const frame = element.matches('div') ? element : element.querySelector('[data-figure-image-frame]')
          const raw = (frame as HTMLElement | null)?.getAttribute?.('data-width-pct')
          return clampInt(raw, 10, 100, 100)
        },
        renderHTML: () => ({}),
      },
      cropHeight: {
        default: null,
        parseHTML: (element) => {
          if (!(element instanceof HTMLElement)) return null
          const frame = element.matches('div') ? element : element.querySelector('[data-figure-image-frame]')
          const raw = (frame as HTMLElement | null)?.getAttribute?.('data-crop-h')
          if (!raw) return null
          return clampInt(raw, 80, 2400, 320)
        },
        renderHTML: () => ({}),
      },
      cropX: {
        default: 50,
        parseHTML: (element) => {
          if (element instanceof HTMLImageElement) return clampInt(element.getAttribute('data-crop-x'), 0, 100, 50)
          if (!(element instanceof HTMLElement)) return 50
          const img = element.querySelector('img')
          return clampInt(img?.getAttribute('data-crop-x'), 0, 100, 50)
        },
        renderHTML: () => ({}),
      },
      cropY: {
        default: 50,
        parseHTML: (element) => {
          if (element instanceof HTMLImageElement) return clampInt(element.getAttribute('data-crop-y'), 0, 100, 50)
          if (!(element instanceof HTMLElement)) return 50
          const img = element.querySelector('img')
          return clampInt(img?.getAttribute('data-crop-y'), 0, 100, 50)
        },
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

    const widthPct = clampInt((node.attrs as any)?.widthPct, 10, 100, 100)
    const cropHeightRaw = (node.attrs as any)?.cropHeight
    const cropHeight = cropHeightRaw == null ? null : clampInt(cropHeightRaw, 80, 2400, 320)
    const cropEnabled = cropHeight != null
    const cropX = clampInt((node.attrs as any)?.cropX, 0, 100, 50)
    const cropY = clampInt((node.attrs as any)?.cropY, 0, 100, 50)
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

    const frameStyleParts: string[] = [`width:${widthPct}%`]
    if (cropEnabled && cropHeight) {
      frameStyleParts.push(`height:${cropHeight}px`)
    } else if (mode === 'transform' && naturalWidth && naturalHeight) {
      const ratio = rotate === 90 || rotate === 270 ? `${naturalHeight} / ${naturalWidth}` : `${naturalWidth} / ${naturalHeight}`
      frameStyleParts.push(`aspect-ratio:${ratio}`)
    }

    const { w, h } = computeRotatedSizeVars({ rotate, crop: cropEnabled, naturalWidth, naturalHeight })
    const imgStyleParts = [
      `--seichi-rot:${formatDeg(rotate)}`,
      `--seichi-flip-x:${flipX ? -1 : 1}`,
      `--seichi-flip-y:${flipY ? -1 : 1}`,
      `--seichi-w:${w}`,
      `--seichi-h:${h}`,
      `--seichi-pos:${formatPct(cropX)} ${formatPct(cropY)}`,
    ]

    return [
      'figure',
      mergeAttributes(HTMLAttributes),
      [
        'div',
        {
          'data-figure-image-frame': 'true',
          'data-mode': mode,
          'data-width-pct': String(widthPct),
          'data-crop-h': cropEnabled && cropHeight ? String(cropHeight) : undefined,
          style: frameStyleParts.join(';'),
        },
        [
          'img',
          {
            src,
            alt,
            draggable: 'true',
            'data-rotate': String(rotate),
            'data-flip-x': flipX ? '1' : '0',
            'data-flip-y': flipY ? '1' : '0',
            'data-crop-x': String(cropX),
            'data-crop-y': String(cropY),
            'data-natural-w': naturalWidth ? String(naturalWidth) : undefined,
            'data-natural-h': naturalHeight ? String(naturalHeight) : undefined,
            style: imgStyleParts.join(';'),
          },
        ],
      ],
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
