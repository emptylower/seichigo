'use client'

import { useCallback, useState } from 'react'

export type UndoEntry = { label: string; revert: () => Promise<void> }

/** 撤销环：最多 limit 条，undo 弹栈执行 revert */
export function useUndoRing(limit = 10) {
  const [stack, setStack] = useState<UndoEntry[]>([])

  const push = useCallback(
    (entry: UndoEntry) => {
      setStack((prev) => [...prev.slice(-(limit - 1)), entry])
    },
    [limit]
  )

  const undo = useCallback(async () => {
    const entry = stack[stack.length - 1]
    if (!entry) return
    setStack((prev) => prev.slice(0, -1))
    await entry.revert()
  }, [stack])

  const clear = useCallback(() => setStack([]), [])

  return {
    push,
    undo,
    clear,
    undoLabel: stack.length ? stack[stack.length - 1]!.label : null,
    undoCount: stack.length,
  }
}
