import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'

import {
  useAgentWatchStream,
  WATCH_RECONNECT_DELAYS_MS,
} from '@/app/(authed)/plan/[id]/hooks/useAgentWatchStream'
import { PLANS_CHANGED_EVENT } from '@/app/(authed)/plan/[id]/components/PlanSidebar'
import type { PlanRunSync } from '@/app/(authed)/plan/[id]/hooks/usePlanRunSync'
import type { ChatEntry, InterruptedInfo } from '@/app/(authed)/plan/[id]/lib/chatState'
import type { ThinkingTurn } from '@/app/(authed)/plan/[id]/components/ThinkingChain'

/** 可手动推帧/报错的观察流响应 */
function makeWatchStream() {
  const encoder = new TextEncoder()
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c
    },
  })
  return {
    response: new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }),
    push(event: unknown) {
      controller!.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
    },
    fail() {
      controller!.error(new Error('network reset'))
    },
    close() {
      controller!.close()
    },
  }
}

function setup() {
  const setChat = vi.fn<(update: React.SetStateAction<ChatEntry[]>) => void>()
  const setBusy = vi.fn()
  const setSyncBanner = vi.fn()
  const setInterrupted = vi.fn()
  const setActiveThinking = vi.fn<(update: React.SetStateAction<ThinkingTurn | null>) => void>()
  const onDone = vi.fn()
  const onStopped = vi.fn<(turn: ThinkingTurn | null) => void>()
  const runSync: PlanRunSync = {
    refreshPlan: vi.fn(async () => {}),
    enterRunRecovery: vi.fn(),
    bumpChatEpoch: vi.fn(),
    clearInterrupted: vi.fn(),
    noteInterrupted: vi.fn(),
    readInterrupted: () => null,
    isPolling: () => false,
  }
  const rendered = renderHook(() =>
    useAgentWatchStream({
      planId: 'plan-1',
      setChat,
      setBusy,
      setSyncBanner,
      setInterrupted,
      setActiveThinking,
      runSync,
      onDone,
      onStopped,
    }),
  )
  return { ...rendered, setChat, setBusy, setSyncBanner, setInterrupted, setActiveThinking, onDone, onStopped, runSync }
}

function watchUrls(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls.map(([url]) => String(url)).filter((url) => url.includes('/agent/stream'))
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useAgentWatchStream（§0.6 只读观察流）', () => {
  it('open() 请求观察流并带 after=0；live 事件重建进行中的思维链', async () => {
    const watch = makeWatchStream()
    const fetchMock = vi.fn(async () => watch.response)
    vi.stubGlobal('fetch', fetchMock)

    const { result, setActiveThinking } = setup()
    act(() => result.current.open())
    expect(result.current.isOpen()).toBe(true)
    await waitFor(() => expect(watchUrls(fetchMock)).toHaveLength(1))
    expect(watchUrls(fetchMock)[0]).toBe('/api/me/plans/plan-1/agent/stream?after=0')

    act(() => {
      watch.push({ type: 'ready', seq: 0 })
      watch.push({
        type: 'live',
        seq: 1,
        reasoning: '整理点位中',
        statusText: '查询点位中',
        toolCalls: [{ name: 'search_points', status: 'running', summary: '宇治' }],
        updatedAt: '2026-09-06T02:00:00.000Z',
      })
    })

    await waitFor(() => expect(setActiveThinking).toHaveBeenCalled())
    const turn = setActiveThinking.mock.calls.at(-1)![0] as ThinkingTurn
    expect(turn.reasoning).toBe('整理点位中')
    expect(turn.statusPhrase).toBe('查询点位中')
    expect(turn.toolCalls).toHaveLength(1)
  })

  it('chat 事件以服务端为准整体合并并推进本地纪元', async () => {
    const watch = makeWatchStream()
    vi.stubGlobal('fetch', vi.fn(async () => watch.response))

    const { result, setChat, runSync } = setup()
    act(() => result.current.open())
    await waitFor(() => expect(fetch).toHaveBeenCalled())

    act(() => {
      watch.push({
        type: 'chat',
        seq: 2,
        chatRevision: 7,
        chat: [
          { role: 'user', text: '帮我规划' },
          { role: 'assistant', text: '好的' },
        ],
      })
    })

    await waitFor(() => expect(setChat).toHaveBeenCalled())
    const updater = setChat.mock.calls.at(-1)![0] as (prev: ChatEntry[]) => ChatEntry[]
    expect(updater([{ role: 'user', text: '帮我规划' }])).toEqual([
      { role: 'user', text: '帮我规划', thinking: undefined, retry: undefined },
      { role: 'assistant', text: '好的' },
    ])
    expect(runSync.bumpChatEpoch).toHaveBeenCalled()
  })

  it('plan_updated 事件刷新计划并广播会话列表变更', async () => {
    const watch = makeWatchStream()
    vi.stubGlobal('fetch', vi.fn(async () => watch.response))
    const onPlansChanged = vi.fn()
    window.addEventListener(PLANS_CHANGED_EVENT, onPlansChanged)

    const { result, runSync } = setup()
    act(() => result.current.open())
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    act(() => watch.push({ type: 'plan_updated', seq: 3 }))

    await waitFor(() => expect(runSync.refreshPlan).toHaveBeenCalled())
    expect(onPlansChanged).toHaveBeenCalled()
    window.removeEventListener(PLANS_CHANGED_EVENT, onPlansChanged)
  })

  it('done 事件收尾：清 busy/思维链/横幅，写入中断标记并交给自动续跑', async () => {
    const watch = makeWatchStream()
    vi.stubGlobal('fetch', vi.fn(async () => watch.response))

    const { result, setBusy, setSyncBanner, setActiveThinking, setInterrupted, onDone, runSync } = setup()
    act(() => result.current.open())
    await waitFor(() => expect(fetch).toHaveBeenCalled())

    const info: InterruptedInfo = { at: '2026-09-06T02:10:00.000Z', turnIndex: 4 }
    act(() => watch.push({ type: 'done', seq: 9, reason: 'finished', stopped: false, interrupted: info }))

    await waitFor(() => expect(setBusy).toHaveBeenCalledWith(false))
    expect(setActiveThinking).toHaveBeenCalledWith(null)
    expect(setSyncBanner).toHaveBeenCalledWith(null)
    expect(setInterrupted).toHaveBeenCalledWith(info)
    expect(runSync.noteInterrupted).toHaveBeenCalledWith(info)
    expect(onDone).toHaveBeenCalled()
    expect(result.current.isOpen()).toBe(false)
  })

  it('读流中断后按退避重连，重连 URL 带上最后 seq', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const first = makeWatchStream()
    const second = makeWatchStream()
    let calls = 0
    const fetchMock = vi.fn(async () => {
      calls += 1
      return calls === 1 ? first.response : second.response
    })
    vi.stubGlobal('fetch', fetchMock)

    const { result } = setup()
    act(() => result.current.open())
    await waitFor(() => expect(watchUrls(fetchMock)).toHaveLength(1))
    act(() => first.push({ type: 'live', seq: 5, reasoning: 'x' }))
    await waitFor(() => expect(result.current.isOpen()).toBe(true))
    act(() => first.fail())

    // 第一次失败：500 ms 后重连，并带上已消费到的 seq
    await act(async () => {
      await vi.advanceTimersByTimeAsync(WATCH_RECONNECT_DELAYS_MS[0]!)
    })
    await waitFor(() => expect(watchUrls(fetchMock)).toHaveLength(2))
    expect(watchUrls(fetchMock)[1]).toBe('/api/me/plans/plan-1/agent/stream?after=5')
  })

  it('连续失败耗尽退避次数后交给 3 秒恢复轮询并关闭观察流', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    // 每次都不是 event-stream：模拟观察流路由不可用
    const fetchMock = vi.fn(async () => new Response('nope', { status: 502 }))
    vi.stubGlobal('fetch', fetchMock)

    const { result, runSync } = setup()
    act(() => result.current.open())

    for (const delay of WATCH_RECONNECT_DELAYS_MS) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(delay)
      })
    }

    await waitFor(() => expect(runSync.enterRunRecovery).toHaveBeenCalledWith('reconnecting'))
    expect(result.current.isOpen()).toBe(false)
    // 首连 + 4 次退避重连，第 5 次失败转轮询
    const attempts = watchUrls(fetchMock).length
    expect(attempts).toBe(WATCH_RECONNECT_DELAYS_MS.length + 1)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    expect(watchUrls(fetchMock)).toHaveLength(attempts)
  })

  it('页面回到前台且未连接时立即重连，不等退避计时器', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const first = makeWatchStream()
    const second = makeWatchStream()
    let calls = 0
    const fetchMock = vi.fn(async () => {
      calls += 1
      return calls === 1 ? first.response : second.response
    })
    vi.stubGlobal('fetch', fetchMock)

    const { result } = setup()
    act(() => result.current.open())
    await waitFor(() => expect(watchUrls(fetchMock)).toHaveLength(1))
    act(() => first.fail())
    await waitFor(() => expect(watchUrls(fetchMock)).toHaveLength(1))

    // 退避计时器（500 ms）还没到就切回前台
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
      await Promise.resolve()
    })
    await waitFor(() => expect(watchUrls(fetchMock)).toHaveLength(2))
  })

  it('旧格式 done（不带 reason）仍按 finished 收尾', async () => {
    const watch = makeWatchStream()
    vi.stubGlobal('fetch', vi.fn(async () => watch.response))

    const { result, setBusy, onDone } = setup()
    act(() => result.current.open())
    await waitFor(() => expect(fetch).toHaveBeenCalled())

    act(() => watch.push({ type: 'done', seq: 3 }))

    await waitFor(() => expect(setBusy).toHaveBeenCalledWith(false))
    expect(onDone).toHaveBeenCalled()
    expect(result.current.isOpen()).toBe(false)
  })

  it("done reason='rotate'：不收尾，重置退避后立即以 after=<lastSeq> 重连", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const first = makeWatchStream()
    const second = makeWatchStream()
    let calls = 0
    const fetchMock = vi.fn(async () => {
      calls += 1
      return calls === 1 ? first.response : second.response
    })
    vi.stubGlobal('fetch', fetchMock)

    const { result, setBusy, onDone } = setup()
    act(() => result.current.open())
    await waitFor(() => expect(watchUrls(fetchMock)).toHaveLength(1))

    act(() => {
      first.push({ type: 'live', seq: 6, reasoning: '仍在跑' })
      first.push({ type: 'done', seq: 7, reason: 'rotate', stopped: false, interrupted: null })
    })

    // 立即重连（不等退避计时器），并带上最后 seq；busy 与观察模式都保持
    await waitFor(() => expect(watchUrls(fetchMock)).toHaveLength(2))
    expect(watchUrls(fetchMock)[1]).toBe('/api/me/plans/plan-1/agent/stream?after=7')
    expect(result.current.isOpen()).toBe(true)
    expect(setBusy).not.toHaveBeenCalledWith(false)
    expect(onDone).not.toHaveBeenCalled()

    // 轮换后的连接照常处理事件
    act(() => second.push({ type: 'done', seq: 8, reason: 'finished', stopped: false, interrupted: null }))
    await waitFor(() => expect(setBusy).toHaveBeenCalledWith(false))
  })

  it("done stopped=true：先把当前实况思维链交给「已停止」定格，再收尾", async () => {
    const watch = makeWatchStream()
    vi.stubGlobal('fetch', vi.fn(async () => watch.response))

    const { result, onStopped, setBusy } = setup()
    act(() => result.current.open())
    await waitFor(() => expect(fetch).toHaveBeenCalled())

    act(() => watch.push({ type: 'live', seq: 1, reasoning: '整理点位中', statusText: '查询点位中', toolCalls: [] }))
    await waitFor(() => expect(onStopped).not.toHaveBeenCalled())
    act(() => watch.push({ type: 'done', seq: 2, reason: 'finished', stopped: true, interrupted: null }))

    await waitFor(() => expect(onStopped).toHaveBeenCalled())
    // 定格的是观察流最后一帧实况，而不是空壳
    const frozen = onStopped.mock.calls.at(-1)![0]
    expect(frozen?.reasoning).toBe('整理点位中')
    expect(setBusy).toHaveBeenCalledWith(false)
    expect(result.current.isOpen()).toBe(false)
  })

  it('close() 与卸载都会中止在途请求且不再重连', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const watch = makeWatchStream()
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      init?.signal?.addEventListener('abort', () => watch.fail())
      return watch.response
    })
    vi.stubGlobal('fetch', fetchMock)

    const { result, unmount } = setup()
    act(() => result.current.open())
    await waitFor(() => expect(watchUrls(fetchMock)).toHaveLength(1))

    act(() => result.current.close())
    expect(result.current.isOpen()).toBe(false)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    expect(watchUrls(fetchMock)).toHaveLength(1)
    unmount()
  })
})
