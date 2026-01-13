"use client"

import { useCallback, useEffect, useMemo, useRef, type MouseEvent as ReactMouseEvent } from 'react'
import { Node, mergeAttributes } from '@tiptap/core'
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { NodeSelection, Plugin } from '@tiptap/pm/state'

type FigureImageAttrs = {
  src: string
  alt?: string
}

type CropHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

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

function parseAlign(value: unknown): 'left' | 'center' | 'right' {
  const v = String(value ?? '').trim().toLowerCase()
  if (v === 'center') return 'center'
  if (v === 'right') return 'right'
  return 'left'
}

function formatPct(value: number): string {
  return `${Math.round(value)}%`
}

function formatDeg(value: number): string {
  return `${normalizeRotate(value)}deg`
}

function computeCropVars(opts: { cropL: number; cropT: number; cropR: number; cropB: number }) {
  const l = clampInt(opts.cropL, 0, 95, 0)
  const t = clampInt(opts.cropT, 0, 95, 0)
  const r = clampInt(opts.cropR, 0, 95, 0)
  const b = clampInt(opts.cropB, 0, 95, 0)

  const fracW = Math.max(1, 100 - l - r)
  const fracH = Math.max(1, 100 - t - b)

  const left = Math.round((-100 * l / fracW) * 100) / 100
  const top = Math.round((-100 * t / fracH) * 100) / 100
  const width = Math.round((10000 / fracW) * 100) / 100
  const height = Math.round((10000 / fracH) * 100) / 100

  return {
    left: `${left}%`,
    top: `${top}%`,
    width: `${width}%`,
    height: `${height}%`,
  }
}

function computeRotatedSizeVars(opts: { rotate: number; naturalWidth: number | null; naturalHeight: number | null }) {
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
  const cropL = clampInt((node.attrs as any)?.cropL, 0, 95, 0)
  const cropT = clampInt((node.attrs as any)?.cropT, 0, 95, 0)
  const cropR = clampInt((node.attrs as any)?.cropR, 0, 95, 0)
  const cropB = clampInt((node.attrs as any)?.cropB, 0, 95, 0)
  const cropEditing = parseBool((node.attrs as any)?.cropEditing)
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

  const cropEnabled = cropL > 0 || cropT > 0 || cropR > 0 || cropB > 0
  const applyCrop = cropEnabled && !cropEditing
  const hasTransforms = applyCrop || rotate !== 0 || flipX || flipY
  const mode: 'plain' | 'transform' = hasTransforms ? 'transform' : 'plain'

  const captionEnabled = parseBool((node.attrs as any)?.caption)
  const captionText = String(node.textContent || '').trim()
  const empty = captionText.length === 0
  const showCaption = captionEnabled || !empty

  const pos = typeof getPos === 'function' ? getPos : null
  const frameRef = useRef<HTMLDivElement | null>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)

  const setNodeSelection = useCallback(() => {
    if (!editor || !pos) return
    const at = pos()
    if (typeof at !== 'number') return
    editor.chain().setNodeSelection(at).focus(undefined, { scrollIntoView: false }).run()
  }, [editor, pos])

  const lastCaptionEnabled = useRef(captionEnabled)
  useEffect(() => {
    if (!editor || !pos) {
      lastCaptionEnabled.current = captionEnabled
      return
    }

    if (captionEnabled && !lastCaptionEnabled.current) {
      const at = pos()
      if (typeof at === 'number') {
        editor.chain().setTextSelection(at + 1).focus(undefined, { scrollIntoView: false }).run()
      }
    }

    lastCaptionEnabled.current = captionEnabled
  }, [captionEnabled, editor, pos])

  const frameStyle = useMemo(() => {
    const style: Record<string, string> = {}
    if (mode === 'transform' && naturalWidth && naturalHeight) {
      const fracW = Math.max(1, 100 - (applyCrop ? cropL : 0) - (applyCrop ? cropR : 0))
      const fracH = Math.max(1, 100 - (applyCrop ? cropT : 0) - (applyCrop ? cropB : 0))
      const w = naturalWidth * fracW
      const h = naturalHeight * fracH
      const ratio = rotate === 90 || rotate === 270 ? `${h} / ${w}` : `${w} / ${h}`
      style['aspect-ratio'] = ratio
    }
    return style
  }, [applyCrop, cropB, cropL, cropR, cropT, mode, naturalHeight, naturalWidth, rotate])

  const imgVars = useMemo(() => {
    const { w, h } = computeRotatedSizeVars({ rotate, naturalWidth, naturalHeight })
    const vars: Record<string, string> = {
      '--seichi-rot': formatDeg(rotate),
      '--seichi-flip-x': String(flipX ? -1 : 1),
      '--seichi-flip-y': String(flipY ? -1 : 1),
      '--seichi-w': w,
      '--seichi-h': h,
    }
    if (applyCrop) {
      const cropVars = computeCropVars({ cropL, cropT, cropR, cropB })
      vars['--seichi-crop-left'] = cropVars.left
      vars['--seichi-crop-top'] = cropVars.top
      vars['--seichi-crop-width'] = cropVars.width
      vars['--seichi-crop-height'] = cropVars.height
    }
    return vars as any
  }, [applyCrop, cropB, cropL, cropR, cropT, flipX, flipY, naturalHeight, naturalWidth, rotate])

  const imgStyle = useMemo(() => {
    if (mode !== 'transform') return imgVars

    const { w, h } = computeRotatedSizeVars({ rotate, naturalWidth, naturalHeight })
    const sx = flipX ? -1 : 1
    const sy = flipY ? -1 : 1

    if (applyCrop) {
      const cropVars = computeCropVars({ cropL, cropT, cropR, cropB })
      return {
        ...imgVars,
        top: cropVars.top,
        left: cropVars.left,
        width: cropVars.width,
        height: cropVars.height,
        transform: `rotate(${rotate}deg) scaleX(${sx}) scaleY(${sy})`,
        transformOrigin: 'center',
        objectFit: 'cover',
        objectPosition: 'center',
      } as any
    }

    return {
      ...imgVars,
      top: '50%',
      left: '50%',
      width: w,
      height: h,
      transform: `translate(-50%, -50%) rotate(${rotate}deg) scaleX(${sx}) scaleY(${sy})`,
      transformOrigin: 'center',
      objectFit: 'contain',
      objectPosition: 'center',
    } as any
  }, [applyCrop, cropB, cropL, cropR, cropT, flipX, flipY, imgVars, mode, naturalHeight, naturalWidth, rotate])

  const cropSession = useRef<{ l: number; t: number; r: number; b: number } | null>(null)
  useEffect(() => {
    if (!cropEditing) {
      cropSession.current = null
      return
    }
    if (!cropSession.current) {
      cropSession.current = { l: cropL, t: cropT, r: cropR, b: cropB }
    }
  }, [cropB, cropEditing, cropL, cropR, cropT])

  const dragState = useRef<
    | { type: 'crop'; handle: CropHandle; startX: number; startY: number; startCrop: { l: number; t: number; r: number; b: number }; rectW: number; rectH: number }
    | { type: 'resize'; startX: number; startWidthPct: number; containerW: number }
    | null
  >(null)

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const state = dragState.current
      if (!state) return

      if (state.type === 'crop') {
        const rectW = state.rectW || 1
        const rectH = state.rectH || 1
        const dx = e.clientX - state.startX
        const dy = e.clientY - state.startY
        const deltaL = Math.round((dx / rectW) * 100)
        const deltaR = Math.round((-dx / rectW) * 100)
        const deltaT = Math.round((dy / rectH) * 100)
        const deltaB = Math.round((-dy / rectH) * 100)

        const minRemaining = 5
        const clampInset = (value: number, opposite: number) => {
          const max = Math.max(0, 100 - minRemaining - opposite)
          return clampInt(value, 0, max, 0)
        }

        let nextL = state.startCrop.l
        let nextT = state.startCrop.t
        let nextR = state.startCrop.r
        let nextB = state.startCrop.b

        if (state.handle.includes('w')) nextL = clampInset(state.startCrop.l + deltaL, state.startCrop.r)
        if (state.handle.includes('e')) nextR = clampInset(state.startCrop.r + deltaR, nextL)
        if (state.handle.includes('n')) nextT = clampInset(state.startCrop.t + deltaT, state.startCrop.b)
        if (state.handle.includes('s')) nextB = clampInset(state.startCrop.b + deltaB, nextT)

        updateAttributes({ cropL: nextL, cropT: nextT, cropR: nextR, cropB: nextB })
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

  const startCropHandleDrag = useCallback(
    (e: ReactMouseEvent, handle: CropHandle) => {
      if (!cropEditing) return
      const frame = frameRef.current
      if (!frame) return
      const rect = frame.getBoundingClientRect()
      dragState.current = {
        type: 'crop',
        handle,
        startX: e.clientX,
        startY: e.clientY,
        startCrop: { l: cropL, t: cropT, r: cropR, b: cropB },
        rectW: rect.width || 1,
        rectH: rect.height || 1,
      }
    },
    [cropB, cropEditing, cropL, cropR, cropT]
  )

  const startResizeDrag = useCallback(
    (e: ReactMouseEvent) => {
      const rect = editor?.view?.dom?.getBoundingClientRect?.()
      const containerW = rect?.width || 800
      dragState.current = { type: 'resize', startX: e.clientX, startWidthPct: widthPct, containerW }
    },
    [editor, widthPct]
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

  useEffect(() => {
    if (!cropEditing) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        const session = cropSession.current
        updateAttributes({
          cropEditing: false,
          cropL: session?.l ?? 0,
          cropT: session?.t ?? 0,
          cropR: session?.r ?? 0,
          cropB: session?.b ?? 0,
        })
        return
      }

      if (e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        updateAttributes({ cropEditing: false })
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [cropEditing, updateAttributes])

  useEffect(() => {
    const frame = frameRef.current
    if (!frame) return

    const wrapper = frame.closest('.node-figureImage') as HTMLElement | null
    if (!wrapper) return

    const onMouseDown = (e: MouseEvent) => {
      if (e.target !== wrapper) return
      setNodeSelection()
    }

    wrapper.addEventListener('mousedown', onMouseDown)
    return () => {
      wrapper.removeEventListener('mousedown', onMouseDown)
    }
  }, [setNodeSelection])

  return (
    <NodeViewWrapper
      as="figure"
      className="my-0"
      data-figure-image="true"
      data-width-pct={String(widthPct)}
      {...HTMLAttributes}
    >
      <div data-figure-image-container data-width-pct={String(widthPct)} className="max-w-full">
        <div
          ref={frameRef}
          data-figure-image-frame
          data-mode={mode}
          style={frameStyle as any}
          onMouseDown={() => {
            setNodeSelection()
          }}
          className={[
            'relative w-full',
            'rounded-lg',
            mode === 'transform' ? 'overflow-hidden' : '',
            'max-w-full',
            selected ? 'ring-2 ring-brand-200' : '',
          ].join(' ')}
        >
          <img
            ref={imgRef}
            src={src}
            alt={alt}
            draggable={!cropEditing}
            contentEditable={false}
            data-drag-handle
            data-rotate={String(rotate)}
            data-flip-x={flipX ? '1' : '0'}
            data-flip-y={flipY ? '1' : '0'}
            data-crop-l={applyCrop && cropL ? String(cropL) : undefined}
            data-crop-t={applyCrop && cropT ? String(cropT) : undefined}
            data-crop-r={applyCrop && cropR ? String(cropR) : undefined}
            data-crop-b={applyCrop && cropB ? String(cropB) : undefined}
            data-natural-w={naturalWidth ? String(naturalWidth) : undefined}
            data-natural-h={naturalHeight ? String(naturalHeight) : undefined}
            style={imgStyle}
            className={[mode === 'transform' ? 'absolute left-1/2 top-1/2 max-w-none' : 'block h-auto w-full', 'rounded-lg'].join(' ')}
            onMouseDown={(e) => {
              setNodeSelection()
            }}
          />

          {cropEditing ? (
            <div data-image-crop-overlay className="absolute inset-0 z-10">
              <div
                className="absolute rounded-md border border-white/80 border-dashed"
                style={{
                  left: `${cropL}%`,
                  top: `${cropT}%`,
                  right: `${cropR}%`,
                  bottom: `${cropB}%`,
                  boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.45)',
                }}
              >
                {(
                  [
                    { handle: 'nw', left: '0%', top: '0%', cursor: 'nwse-resize' },
                    { handle: 'n', left: '50%', top: '0%', cursor: 'ns-resize' },
                    { handle: 'ne', left: '100%', top: '0%', cursor: 'nesw-resize' },
                    { handle: 'e', left: '100%', top: '50%', cursor: 'ew-resize' },
                    { handle: 'se', left: '100%', top: '100%', cursor: 'nwse-resize' },
                    { handle: 's', left: '50%', top: '100%', cursor: 'ns-resize' },
                    { handle: 'sw', left: '0%', top: '100%', cursor: 'nesw-resize' },
                    { handle: 'w', left: '0%', top: '50%', cursor: 'ew-resize' },
                  ] as Array<{ handle: CropHandle; left: string; top: string; cursor: string }>
                ).map((cfg) => (
                  <button
                    key={cfg.handle}
                    type="button"
                    data-image-crop-handle={cfg.handle}
                    aria-label={`裁剪控制点 ${cfg.handle}`}
                    className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-sm bg-white shadow"
                    style={{ left: cfg.left, top: cfg.top, cursor: cfg.cursor }}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      setNodeSelection()
                      startCropHandleDrag(e, cfg.handle)
                    }}
                  />
                ))}
              </div>
            </div>
          ) : null}

          {selected ? (
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
          ) : null}
        </div>

        <figcaption className="mt-2 text-sm text-gray-600" hidden={!showCaption}>
          <NodeViewContent
            as="div"
            data-figure-caption={showCaption ? 'true' : undefined}
            data-placeholder={showCaption ? '写说明…' : undefined}
            data-empty={showCaption && empty ? 'true' : undefined}
            className="outline-none"
            onBlur={() => {
              if (!captionEnabled) return
              if (!empty) return
              updateAttributes({ caption: false })
            }}
          />
        </figcaption>
      </div>
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
          return chain().insertContent({ type: this.name, attrs: { src, alt } }).run()
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
