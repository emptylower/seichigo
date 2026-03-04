"use client"

import { useCallback, useEffect, useMemo, useRef, type MouseEvent as ReactMouseEvent } from 'react'
import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import {
  clampInt,
  computeCropVars,
  computeRotatedSizeVars,
  formatDeg,
  normalizeRotate,
  parseBool,
  type CropHandle,
} from './figureImageUtils'

export default function FigureImageView({ node, selected, editor, getPos, updateAttributes, HTMLAttributes }: NodeViewProps) {
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
    } else if (mode === 'plain' && naturalWidth && naturalHeight) {
      style['aspect-ratio'] = `${naturalWidth} / ${naturalHeight}`
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
            width={naturalWidth ?? undefined}
            height={naturalHeight ?? undefined}
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
