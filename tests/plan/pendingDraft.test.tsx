import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'

import {
  PENDING_DRAFT_KEY,
  takePendingDraft,
  usePendingDraft,
} from '@/app/(authed)/plan/[id]/hooks/usePendingDraft'

const autoSent: string[] = []
const prefilled: string[] = []

function Harness({ hasMessages, canSend = true }: { hasMessages: boolean; canSend?: boolean }) {
  usePendingDraft({
    hasMessages,
    // onAutoSend 返回「真的发出去了吗」：false 代表这一刻发不出（例如上一轮还在跑）
    onAutoSend: (text) => {
      if (!canSend) return false
      autoSent.push(text)
      return true
    },
    onPrefill: (text) => prefilled.push(text),
  })
  return <div />
}

function writePending(text: string, createdAt: number) {
  window.sessionStorage.setItem(PENDING_DRAFT_KEY, JSON.stringify({ text, createdAt }))
}

describe('usePendingDraft（起始页交接过来的第一条消息）', () => {
  beforeEach(() => {
    autoSent.length = 0
    prefilled.length = 0
    window.sessionStorage.clear()
    vi.useRealTimers()
  })

  it('计划还没有任何消息时自动发送一次，并清掉 sessionStorage', () => {
    writePending('东京 8 天巡礼', Date.now())

    const view = render(<Harness hasMessages={false} />)
    expect(autoSent).toEqual(['东京 8 天巡礼'])
    expect(prefilled).toEqual([])
    expect(window.sessionStorage.getItem(PENDING_DRAFT_KEY)).toBeNull()

    // 重挂载不会重复发送（草稿已被取走）
    view.unmount()
    render(<Harness hasMessages={false} />)
    expect(autoSent).toEqual(['东京 8 天巡礼'])
  })

  it('中-9：发不出去（上一轮还在跑）时回退为预填，不丢草稿', () => {
    writePending('大阪 4 天', Date.now())

    render(<Harness hasMessages={false} canSend={false} />)
    expect(autoSent).toEqual([])
    expect(prefilled).toEqual(['大阪 4 天'])
  })

  it('计划已有消息时只预填输入框', () => {
    writePending('京都 3 天', Date.now())

    render(<Harness hasMessages />)
    expect(prefilled).toEqual(['京都 3 天'])
    expect(autoSent).toEqual([])
  })

  it('超过 10 分钟的草稿不再使用', () => {
    writePending('过期草稿', Date.now() - 11 * 60 * 1000)

    render(<Harness hasMessages={false} />)
    expect(autoSent).toEqual([])
    expect(prefilled).toEqual([])
    expect(window.sessionStorage.getItem(PENDING_DRAFT_KEY)).toBeNull()
  })

  it('没有草稿 / 载荷畸形时什么都不做', () => {
    render(<Harness hasMessages={false} />)
    expect(autoSent).toEqual([])

    window.sessionStorage.setItem(PENDING_DRAFT_KEY, 'not json')
    expect(takePendingDraft()).toBeNull()

    window.sessionStorage.setItem(PENDING_DRAFT_KEY, JSON.stringify({ text: '   ', createdAt: Date.now() }))
    expect(takePendingDraft()).toBeNull()
  })
})
