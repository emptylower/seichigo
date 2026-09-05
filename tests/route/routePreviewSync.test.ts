import { describe, it, expect, vi } from 'vitest'
import { createPendingSync } from '@/components/route/routePreviewSync'

describe('createPendingSync（切天丢更新修复：挂起最新一次同步）', () => {
  it('ready 前多次 request 只保留并执行最后一次', () => {
    const sync = createPendingSync()
    const first = vi.fn()
    const second = vi.fn()
    const third = vi.fn()
    sync.request(first)
    sync.request(second)
    sync.request(third)
    expect(first).not.toHaveBeenCalled()
    expect(second).not.toHaveBeenCalled()
    expect(third).not.toHaveBeenCalled()

    sync.markReady()
    expect(first).not.toHaveBeenCalled()
    expect(second).not.toHaveBeenCalled()
    expect(third).toHaveBeenCalledTimes(1)
  })

  it('ready 后 request 立即执行', () => {
    const sync = createPendingSync()
    sync.markReady()
    const apply = vi.fn()
    sync.request(apply)
    expect(apply).toHaveBeenCalledTimes(1)
  })

  it('markReady 无挂起时不动作；挂起执行一次后清空', () => {
    const sync = createPendingSync()
    expect(() => sync.markReady()).not.toThrow()
    const apply = vi.fn()
    sync.request(apply)
    sync.markReady()
    sync.markReady()
    expect(apply).toHaveBeenCalledTimes(1)
  })

  it('reset 后回到挂起态（provider failover setStyle 后等下一次 markReady）', () => {
    const sync = createPendingSync()
    sync.markReady()
    const apply = vi.fn()
    sync.reset()
    sync.request(apply)
    expect(apply).not.toHaveBeenCalled()
    sync.markReady()
    expect(apply).toHaveBeenCalledTimes(1)
  })

  it('reset 丢弃挂起的更新', () => {
    const sync = createPendingSync()
    const stale = vi.fn()
    sync.request(stale)
    sync.reset()
    sync.markReady()
    expect(stale).not.toHaveBeenCalled()
  })
})
