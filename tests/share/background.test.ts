import { afterEach, describe, expect, it, vi } from 'vitest'
import { runShareBackground } from '@/lib/share/background'

const CF_CONTEXT_SYMBOL = Symbol.for('__cloudflare-context__')

afterEach(() => {
  delete (globalThis as any)[CF_CONTEXT_SYMBOL]
  vi.restoreAllMocks()
})

describe('runShareBackground', () => {
  it('有 ctx 时以 ctx 为 this 调用 waitUntil，不 await', async () => {
    const seen: unknown[] = []
    const ctx = {
      marker: 'ctx',
      waitUntil(promise: Promise<unknown>) {
        // 解构调用会丢 this 抛 Illegal invocation，这里断言 this 还在
        expect((this as { marker?: string }).marker).toBe('ctx')
        seen.push(promise)
      },
    }
    ;(globalThis as any)[CF_CONTEXT_SYMBOL] = { ctx }
    runShareBackground(Promise.resolve('ok'))
    expect(seen).toHaveLength(1)
  })

  it('没有 ctx 时吞掉 rejection，不炸调用方', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    runShareBackground(Promise.reject(new Error('boom')))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(error).toHaveBeenCalledWith('[share.background.failed]', expect.any(Object))
  })
})
