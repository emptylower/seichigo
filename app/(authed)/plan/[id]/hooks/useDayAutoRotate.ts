'use client'

import { useEffect, useRef, useState, type RefObject } from 'react'

const DEFAULT_INTERVAL_MS = 5000

/** 页面是否在前台（SSR / 老浏览器没有 visibilityState 时按前台算） */
function documentVisible(): boolean {
  if (typeof document === 'undefined') return true
  return document.visibilityState !== 'hidden'
}

/**
 * 展示型 DayCards（首页第二屏）用的 Day 标签自动轮播。
 *
 * 中-6：只在**可见**（containerRef 进视口）且**前台**（页面没被切走）时走，
 * 转满一圈就自己停——展示只是引子，不该在没人看的时候一直烧定时器和重绘；
 * 用户任何一次手动交互（点 Day 标签、切视图）后永久停止，不再抢控制权。
 *
 * 没有 IntersectionObserver 的环境（老浏览器 / 部分测试环境）按"可见"处理，
 * 退化成原来的行为而不是干脆不转。
 */
export function useDayAutoRotate(params: {
  enabled: boolean
  dayIndexes: number[]
  onRotate: (dayIndex: number) => void
  intervalMs?: number
}): { stop: () => void; containerRef: RefObject<HTMLDivElement | null> } {
  const { enabled, dayIndexes, onRotate, intervalMs = DEFAULT_INTERVAL_MS } = params
  const [stopped, setStopped] = useState(false)
  const [inView, setInView] = useState(typeof IntersectionObserver === 'undefined')
  const [foreground, setForeground] = useState(true)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const onRotateRef = useRef(onRotate)
  onRotateRef.current = onRotate
  const cursorRef = useRef(0)
  const key = dayIndexes.join(',')

  useEffect(() => {
    if (!enabled || typeof IntersectionObserver === 'undefined') return
    const node = containerRef.current
    if (!node) return
    const observer = new IntersectionObserver((entries) => {
      setInView(entries.some((entry) => entry.isIntersecting))
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [enabled])

  useEffect(() => {
    if (!enabled) return
    const sync = () => setForeground(documentVisible())
    sync()
    document.addEventListener('visibilitychange', sync)
    return () => document.removeEventListener('visibilitychange', sync)
  }, [enabled])

  useEffect(() => {
    if (!enabled || stopped || !inView || !foreground) return
    const indexes = key ? key.split(',').map(Number) : []
    if (indexes.length < 2) return
    const timer = setInterval(() => {
      cursorRef.current = (cursorRef.current + 1) % indexes.length
      onRotateRef.current(indexes[cursorRef.current]!)
      // 回到起点＝转满一圈，就此打住
      if (cursorRef.current === 0) setStopped(true)
    }, intervalMs)
    return () => clearInterval(timer)
  }, [enabled, stopped, inView, foreground, key, intervalMs])

  return { stop: () => setStopped(true), containerRef }
}
