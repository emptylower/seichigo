import { describe, it, expect } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useUndoRing } from '@/app/(authed)/me/routebooks/[id]/hooks/useUndoRing'

describe('useUndoRing（撤销环）', () => {
  it('push 后 undo 按 LIFO 弹栈执行 revert', async () => {
    const calls: string[] = []
    const { result } = renderHook(() => useUndoRing())

    act(() => {
      result.current.push({ label: '第一步', revert: async () => { calls.push('第一步') } })
    })
    act(() => {
      result.current.push({ label: '第二步', revert: async () => { calls.push('第二步') } })
    })

    expect(result.current.undoCount).toBe(2)
    expect(result.current.undoLabel).toBe('第二步')

    await act(async () => {
      await result.current.undo()
    })
    expect(calls).toEqual(['第二步'])
    expect(result.current.undoLabel).toBe('第一步')

    await act(async () => {
      await result.current.undo()
    })
    expect(calls).toEqual(['第二步', '第一步'])
    expect(result.current.undoCount).toBe(0)
    expect(result.current.undoLabel).toBeNull()
  })

  it('空栈 undo 不动作', async () => {
    const { result } = renderHook(() => useUndoRing())
    await act(async () => {
      await result.current.undo()
    })
    expect(result.current.undoCount).toBe(0)
  })

  it('超出上限 10 时丢弃最旧条目', async () => {
    const calls: string[] = []
    const { result } = renderHook(() => useUndoRing())

    act(() => {
      for (let i = 0; i < 12; i += 1) {
        const label = `op-${i}`
        result.current.push({ label, revert: async () => { calls.push(label) } })
      }
    })

    expect(result.current.undoCount).toBe(10)
    expect(result.current.undoLabel).toBe('op-11')

    // 全部弹完：应只剩 op-11..op-2（op-0、op-1 被挤出）
    for (let i = 0; i < 10; i += 1) {
      await act(async () => {
        await result.current.undo()
      })
    }
    expect(calls).toEqual(['op-11', 'op-10', 'op-9', 'op-8', 'op-7', 'op-6', 'op-5', 'op-4', 'op-3', 'op-2'])
    expect(result.current.undoCount).toBe(0)
  })

  it('clear 清空栈', () => {
    const { result } = renderHook(() => useUndoRing())
    act(() => {
      result.current.push({ label: 'x', revert: async () => undefined })
    })
    expect(result.current.undoCount).toBe(1)
    act(() => {
      result.current.clear()
    })
    expect(result.current.undoCount).toBe(0)
    expect(result.current.undoLabel).toBeNull()
  })
})
