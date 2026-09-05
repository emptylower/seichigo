import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, renderHook, screen, fireEvent, waitFor } from '@testing-library/react'

// PlanPlanner 依赖链的轻量桩：Link 需要 app router 上下文，地图/图片是重依赖
vi.mock('next/link', () => ({
  default: (props: { href: string; 'aria-label'?: string; children: React.ReactNode }) => (
    <a href={props.href} aria-label={props['aria-label']}>
      {props.children}
    </a>
  ),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))
vi.mock('@/components/route/RoutePreviewMap', () => ({
  RoutePreviewMap: () => <div data-testid="route-map" />,
}))
vi.mock('@/components/map/ResilientMapImage', () => ({
  default: (props: { src: string | null; alt: string }) => (
    <div data-testid="resilient-image" data-src={props.src ?? ''} aria-label={props.alt} />
  ),
}))

import { PlanPlanner } from '@/app/(authed)/plan/[id]/ui'
import { STOP_FALLBACK_ABORT_MS, useAgentStop } from '@/app/(authed)/plan/[id]/hooks/useAgentStop'
import type { TripPlanView } from '@/lib/tripPlan/view'

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
  Element.prototype.scrollIntoView = vi.fn() as unknown as typeof Element.prototype.scrollIntoView
  window.sessionStorage.clear()
})

function makePlan(): TripPlanView {
  return {
    id: 'plan-1',
    title: '京吹巡礼',
    status: 'draft',
    startDate: null,
    dayCount: 0,
    bangumiIds: [115908],
    updatedAt: new Date().toISOString(),
    days: [],
  }
}

/** 可手动推帧的 SSE 响应（模拟服务端仍在跑的 run） */
function makeSse() {
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
    close() {
      controller!.close()
    },
  }
}

const IDLE_GET = { plan: makePlan(), chat: [], agentBusy: false, interrupted: null }

function bodyOf(init: unknown): Record<string, unknown> {
  const raw = (init as RequestInit | undefined)?.body
  try {
    return JSON.parse(String(raw)) as Record<string, unknown>
  } catch {
    return {}
  }
}

describe('B1 停止本轮规划（§0 stop 契约）', () => {
  async function startBusyRun() {
    const sse = makeSse()
    let runs = 0
    const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/agent')) {
        if ('stop' in bodyOf(init)) {
          return new Response(JSON.stringify({ ok: true, stopped: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        runs += 1
        // 第 2 次（手动「继续」）另开一条流：同一个 Response 的 body 只能读一次
        if (runs > 1) {
          const next = makeSse()
          next.close()
          return next.response
        }
        return sse.response
      }
      return new Response(JSON.stringify(IDLE_GET), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<PlanPlanner plans={[]} planId="plan-1" initialPlan={makePlan()} initialChat={[]} />)
    const textarea = screen.getByPlaceholderText(/告诉规划师/)
    fireEvent.change(textarea, { target: { value: '帮我规划宇治 3 天' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    return { sse, fetchMock }
  }

  it('busy 时发送按钮位置变成「停止」按钮', async () => {
    await startBusyRun()
    await waitFor(() => expect(screen.getByRole('button', { name: '停止' })).toBeTruthy())
    expect(screen.queryByRole('button', { name: '发送' })).toBeNull()
  })

  it('点击「停止」→ POST {stop:true}，并把自动续跑标记记为已消费', async () => {
    const { fetchMock } = await startBusyRun()
    await waitFor(() => expect(screen.getByRole('button', { name: '停止' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: '停止' }))

    await waitFor(() => {
      const stopCalls = fetchMock.mock.calls.filter(
        ([url, init]) => String(url).includes('/agent') && 'stop' in bodyOf(init),
      )
      expect(stopCalls).toHaveLength(1)
      expect(bodyOf(stopCalls[0]![1])).toEqual({ stop: true })
    })
    expect(window.sessionStorage.getItem('planAutoResume:plan-1')).not.toBeNull()
  })

  it('收到 stopped 事件：横幅「已停止本轮规划」+「继续」按钮，且不会自动 POST {resume:true}', async () => {
    const { sse, fetchMock } = await startBusyRun()
    await waitFor(() => expect(screen.getByRole('button', { name: '停止' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: '停止' }))

    await act(async () => {
      sse.push({ type: 'stopped' })
      sse.push({ type: 'done' })
      sse.close()
      await Promise.resolve()
    })

    await waitFor(() => expect(screen.getByText(/已停止本轮规划/)).toBeTruthy())
    expect(screen.getByRole('button', { name: '继续' })).toBeTruthy()
    // 停止后既不进入「连接中断」恢复轮询，也不自动续跑
    expect(screen.queryByText('连接中断，正在同步进度…')).toBeNull()
    expect(
      fetchMock.mock.calls.filter(([url, init]) => String(url).includes('/agent') && 'resume' in bodyOf(init)),
    ).toHaveLength(0)

    // 用户手动点「继续」才发起 resume 回合
    fireEvent.click(screen.getByRole('button', { name: '继续' }))
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.filter(([url, init]) => String(url).includes('/agent') && 'resume' in bodyOf(init)),
      ).toHaveLength(1),
    )
  })
})

describe('M5 「已停止」定格进历史思维链', () => {
  async function startBusyRun() {
    const sse = makeSse()
    const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/agent')) {
        if ('stop' in bodyOf(init)) {
          return new Response(JSON.stringify({ ok: true, stopped: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        return sse.response
      }
      return new Response(JSON.stringify(IDLE_GET), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<PlanPlanner plans={[]} planId="plan-1" initialPlan={makePlan()} initialChat={[]} />)
    fireEvent.change(screen.getByPlaceholderText(/告诉规划师/), { target: { value: '帮我规划宇治 3 天' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '停止' })).toBeTruthy())
    return sse
  }

  it('停止后本轮遥测定格为「已停止」留在时间线上，随后的 done 不清掉它', async () => {
    const sse = await startBusyRun()
    await act(async () => {
      sse.push({ type: 'reasoning', delta: '先看看宇治有哪些点位' })
      sse.push({
        type: 'tool_call',
        id: 't1',
        name: 'list_points',
        argsSummary: '列出宇治点位',
        status: 'done',
        durationMs: 120,
      })
      await Promise.resolve()
    })
    fireEvent.click(screen.getByRole('button', { name: '停止' }))
    await act(async () => {
      sse.push({ type: 'stopped' })
      sse.push({ type: 'done' })
      sse.close()
      await Promise.resolve()
    })

    await waitFor(() => expect(screen.getByText(/已停止本轮规划/)).toBeTruthy())
    // 定格态（非进行中状态条）：摘要行显示「已停止」，思考过程仍可回看
    const frozen = await screen.findByText(/^已停止 · /)
    expect(frozen.tagName).toBe('P')
    fireEvent.click(screen.getByText('查看思考过程'))
    expect(screen.getByText('先看看宇治有哪些点位')).toBeTruthy()
  })

  it('本轮还没有任何遥测就被停止：仍留下一条「已停止」，不留空气泡', async () => {
    const sse = await startBusyRun()
    fireEvent.click(screen.getByRole('button', { name: '停止' }))
    await act(async () => {
      sse.push({ type: 'stopped' })
      sse.push({ type: 'done' })
      sse.close()
      await Promise.resolve()
    })

    const frozen = await screen.findByText(/^已停止/, { selector: 'p' })
    expect(frozen).toBeTruthy()
    // 无内容可回看时不给「查看思考过程」入口，也不渲染空的 assistant 气泡
    expect(screen.queryByText('查看思考过程')).toBeNull()
    expect(document.querySelectorAll('[class*="max-w-[92%]"]')).toHaveLength(0)
  })
})

describe('useAgentStop 本地兜底 abort', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('5 秒内没收到 stopped：本地 abort 本轮读流并置为已停止', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true, stopped: true }), { status: 200 })))
    const { result } = renderHook(() => useAgentStop('plan-1'))

    let signal!: AbortSignal
    act(() => {
      signal = result.current.beginRun()
    })
    await act(async () => {
      await result.current.requestStop()
    })
    expect(signal.aborted).toBe(false)
    expect(result.current.stopRequested).toBe(true)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(STOP_FALLBACK_ABORT_MS + 10)
    })
    expect(signal.aborted).toBe(true)
    expect(result.current.stopped).toBe(true)
  })

  it('收到 stopped 事件后不再触发兜底 abort', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true, stopped: true }), { status: 200 })))
    const { result } = renderHook(() => useAgentStop('plan-1'))

    let signal!: AbortSignal
    act(() => {
      signal = result.current.beginRun()
    })
    await act(async () => {
      await result.current.requestStop()
    })
    act(() => {
      result.current.markStopped()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(STOP_FALLBACK_ABORT_MS + 10)
    })
    expect(signal.aborted).toBe(false)
    expect(result.current.stopped).toBe(true)
  })
})
