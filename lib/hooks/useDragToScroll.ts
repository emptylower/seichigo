'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'

const DRAG_THRESHOLD_PX = 6
const SUPPRESS_CLICK_MS = 120

/**
 * 横向滚动容器的"按住拖动滚动"交互（grab-to-scroll）。
 * 全站滚动条已彻底隐藏（d704887），桌面纯鼠标用户够不到被裁切的横向内容，
 * 这个 hook 提供鼠标拖拽作为访问手段；触摸/触控板原生手势不受影响。
 * 用法：<div ref={ref} {...handlers} className={cursorClass} />
 */
export function useDragToScroll<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T | null>(null)
  const isMouseDownRef = useRef(false)
  const dragStartXRef = useRef(0)
  const dragStartScrollLeftRef = useRef(0)
  const didDragRef = useRef(false)
  const suppressClickRef = useRef(false)
  const suppressClickTimerRef = useRef<number | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  useEffect(() => {
    return () => {
      if (suppressClickTimerRef.current !== null) {
        window.clearTimeout(suppressClickTimerRef.current)
      }
    }
  }, [])

  const endMouseDrag = useCallback(() => {
    if (!isMouseDownRef.current) return
    isMouseDownRef.current = false
    setIsDragging(false)
    if (didDragRef.current) {
      // 拖动刚结束时抑制紧随其后的 click，避免误触发卡片点击
      suppressClickRef.current = true
      if (suppressClickTimerRef.current !== null) {
        window.clearTimeout(suppressClickTimerRef.current)
      }
      suppressClickTimerRef.current = window.setTimeout(() => {
        suppressClickRef.current = false
        suppressClickTimerRef.current = null
      }, SUPPRESS_CLICK_MS)
    }
  }, [])

  const onMouseDown = useCallback((event: ReactMouseEvent<T>) => {
    if (event.button !== 0) return
    const el = ref.current
    if (!el) return
    isMouseDownRef.current = true
    dragStartXRef.current = event.clientX
    dragStartScrollLeftRef.current = el.scrollLeft
    didDragRef.current = false
    setIsDragging(true)
  }, [])

  const onMouseMove = useCallback((event: ReactMouseEvent<T>) => {
    const el = ref.current
    if (!el || !isMouseDownRef.current) return
    const deltaX = event.clientX - dragStartXRef.current
    if (!didDragRef.current && Math.abs(deltaX) > DRAG_THRESHOLD_PX) {
      didDragRef.current = true
    }
    if (!didDragRef.current) return
    el.scrollLeft = dragStartScrollLeftRef.current - deltaX
    event.preventDefault()
  }, [])

  const onClickCapture = useCallback((event: ReactMouseEvent<T>) => {
    if (!suppressClickRef.current) return
    event.preventDefault()
    event.stopPropagation()
    suppressClickRef.current = false
  }, [])

  // 防止拖动 <img>/<a> 时触发浏览器原生 HTML5 拖拽抢走 mouse 事件流
  const onDragStart = useCallback((event: ReactMouseEvent<T>) => {
    event.preventDefault()
  }, [])

  const handlers = { onMouseDown, onMouseMove, onMouseUp: endMouseDrag, onMouseLeave: endMouseDrag, onClickCapture, onDragStart }
  // 拖动期间禁掉文本选中，给出 grab/grabbing 光标反馈
  const cursorClass = isDragging ? 'cursor-grabbing select-none' : 'cursor-grab'

  return { ref, isDragging, handlers, cursorClass }
}
