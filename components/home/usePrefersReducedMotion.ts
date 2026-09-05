'use client'

import { useEffect, useState } from 'react'

const QUERY = '(prefers-reduced-motion: reduce)'

/**
 * 首屏三处动效（打字机占位、规划师微演示、作品名滚动条）共用的降级开关。
 * 首帧一律返回 false：服务端没有 matchMedia，先按"有动效"渲染再由 effect 修正，
 * 避免水合不一致；jsdom / 老浏览器没有 matchMedia 时同样按 false 处理。
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const query = window.matchMedia(QUERY)
    setReduced(query.matches)
    const onChange = () => setReduced(query.matches)
    query.addEventListener?.('change', onChange)
    return () => query.removeEventListener?.('change', onChange)
  }, [])

  return reduced
}
