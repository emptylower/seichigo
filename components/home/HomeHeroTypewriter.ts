'use client'

import { useEffect, useState } from 'react'

export type TypewriterOptions = {
  typeMs?: number
  holdMs?: number
  eraseMs?: number
  /** 用户聚焦/输入或 prefers-reduced-motion 时置 false：定时器不启动，返回空串 */
  enabled?: boolean
}

/**
 * 输入框占位的打字机：逐字打出一条示例 → hold → 逐字擦掉 → 换下一条，无限循环。
 * 只用 setTimeout 串起来（假计时器可逐步推进），停用时清掉定时器并交回静态占位。
 */
export function useTypewriterPlaceholder(examples: string[], options: TypewriterOptions = {}): string {
  const { typeMs = 45, holdMs = 1800, eraseMs = 20, enabled = true } = options
  // 数组每次渲染都是新引用，用一个稳定的字符串做 effect 依赖（示例里不会有换行）
  const joined = examples.join('\n')
  const [text, setText] = useState('')

  useEffect(() => {
    const list = joined ? joined.split('\n') : []
    if (!enabled || !list.length) return

    let index = 0
    let pos = 0
    let erasing = false
    let timer: ReturnType<typeof setTimeout>

    const tick = () => {
      const current = list[index % list.length]!
      if (!erasing) {
        pos = Math.min(pos + 1, current.length)
        setText(current.slice(0, pos))
        if (pos >= current.length) {
          erasing = true
          timer = setTimeout(tick, holdMs)
        } else {
          timer = setTimeout(tick, typeMs)
        }
        return
      }
      pos = Math.max(pos - 1, 0)
      setText(current.slice(0, pos))
      if (pos <= 0) {
        erasing = false
        index += 1
        timer = setTimeout(tick, typeMs)
      } else {
        timer = setTimeout(tick, eraseMs)
      }
    }

    timer = setTimeout(tick, typeMs)
    return () => clearTimeout(timer)
  }, [joined, enabled, typeMs, holdMs, eraseMs])

  return enabled ? text : ''
}
