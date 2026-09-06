import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react'

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

/** 可手动推帧的观察流响应 */
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

function urlsOf(fetchMock: ReturnType<typeof vi.fn>, needle: string): string[] {
  return fetchMock.mock.calls.map(([url]) => String(url)).filter((url) => url.includes(needle))
}

describe('§0.6 队列化 run + 观察流接入', () => {
  /** POST /agent 返回 202 {queued}；GET /agent/stream 返回可手动推帧的观察流 */
  function mockQueuedBackend(options?: { getBody?: unknown }) {
    const watch = makeWatchStream()
    const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/agent/stream')) return watch.response
      if (url.includes('/agent')) {
        if ('stop' in bodyOf(init)) {
          return new Response(JSON.stringify({ ok: true, stopped: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        return new Response(JSON.stringify({ queued: true, runToken: 'run-1' }), {
          status: 202,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response(JSON.stringify(options?.getBody ?? IDLE_GET), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    return { watch, fetchMock }
  }

  async function sendTurn(fetchMock: ReturnType<typeof vi.fn>) {
    render(<PlanPlanner plans={[]} planId="plan-1" initialPlan={makePlan()} initialChat={[]} />)
    fireEvent.change(screen.getByPlaceholderText(/告诉规划师/), { target: { value: '帮我规划宇治 3 天' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    await waitFor(() => expect(urlsOf(fetchMock, '/agent/stream')).toHaveLength(1))
  }

  it('POST 返回 202 {queued}：打开观察流、busy 保持 true、不显示恢复横幅', async () => {
    const { fetchMock } = mockQueuedBackend()
    await sendTurn(fetchMock)

    expect(urlsOf(fetchMock, '/agent/stream')[0]).toContain('/api/me/plans/plan-1/agent/stream?after=')
    // busy：输入胶囊上是「停止」而不是「发送」
    await waitFor(() => expect(screen.getByRole('button', { name: '停止' })).toBeTruthy())
    // 本地发起的回合不显示「规划仍在进行中…」
    expect(screen.queryByText('规划仍在进行中…')).toBeNull()
    expect(screen.queryByText('连接中断，正在同步进度…')).toBeNull()
  })

  it('观察流事件：live 渲染思维链、chat 落地消息、done 收尾放开输入', async () => {
    const { watch, fetchMock } = mockQueuedBackend()
    await sendTurn(fetchMock)

    act(() => {
      watch.push({ type: 'ready', seq: 0 })
      watch.push({
        type: 'live',
        seq: 1,
        reasoning: '整理宇治点位',
        statusText: '查询点位中',
        toolCalls: [],
        updatedAt: '2026-09-06T02:00:00.000Z',
      })
    })
    await waitFor(() => expect(screen.getByText('查询点位中')).toBeTruthy())

    act(() =>
      watch.push({
        type: 'chat',
        seq: 2,
        chatRevision: 2,
        chat: [
          { role: 'user', text: '帮我规划宇治 3 天' },
          { role: 'assistant', text: '这是宇治两日行程。' },
        ],
      }),
    )
    await waitFor(() => expect(screen.getByText('这是宇治两日行程。')).toBeTruthy())

    act(() => watch.push({ type: 'done', seq: 3, interrupted: null }))
    await waitFor(() => expect(screen.getByRole('button', { name: '发送' })).toBeTruthy())
    expect(screen.queryByText('查询点位中')).toBeNull()
  })

  it('观察流模式下「停止」按钮可点，POST body 仍是 {stop:true}', async () => {
    const { watch, fetchMock } = mockQueuedBackend()
    await sendTurn(fetchMock)

    await waitFor(() => expect(screen.getByRole('button', { name: '停止' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: '停止' }))

    await waitFor(() => {
      const stopCalls = fetchMock.mock.calls.filter(([, init]) => 'stop' in bodyOf(init))
      expect(stopCalls).toHaveLength(1)
      expect(bodyOf(stopCalls[0]![1])).toEqual({ stop: true })
    })

    // 服务端结束 run 后观察流推 done{stopped}：不必等 5 秒兜底就按「已停止」收尾
    act(() => watch.push({ type: 'done', seq: 4, reason: 'finished', stopped: true, interrupted: null }))
    await waitFor(() => expect(screen.getByText(/已停止本轮规划/)).toBeTruthy())
    // 本轮实况以「已停止」定格留在时间线上
    expect(await screen.findByText(/^已停止/, { selector: 'p' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '发送' })).toBeTruthy()
  })

  it("观察流 done reason='rotate'：连接轮换不收尾，busy 与思维链都保持", async () => {
    const { watch, fetchMock } = mockQueuedBackend()
    await sendTurn(fetchMock)

    act(() => {
      watch.push({ type: 'live', seq: 1, reasoning: '整理宇治点位', statusText: '查询点位中', toolCalls: [] })
      watch.push({ type: 'done', seq: 2, reason: 'rotate', stopped: false, interrupted: null })
    })

    // 换一条连接继续观察：仍是 busy（停止按钮在位），实况不清空
    await waitFor(() => expect(urlsOf(fetchMock, '/agent/stream')).toHaveLength(2))
    expect(urlsOf(fetchMock, '/agent/stream')[1]).toContain('after=2')
    expect(screen.getByRole('button', { name: '停止' })).toBeTruthy()
    expect(screen.getByText('查询点位中')).toBeTruthy()
  })

  it('刷新后服务端仍在跑：打开观察流并保留「规划仍在进行中…」横幅', async () => {
    const busyGet = {
      plan: makePlan(),
      chat: [{ role: 'user', text: '帮我规划宇治 3 天' }],
      agentBusy: true,
      interrupted: null,
    }
    const { watch, fetchMock } = mockQueuedBackend({ getBody: busyGet })

    render(
      <PlanPlanner
        plans={[]}
        planId="plan-1"
        initialPlan={makePlan()}
        initialChat={[{ role: 'user', text: '帮我规划宇治 3 天' }]}
      />,
    )

    await waitFor(() => expect(screen.getByText('规划仍在进行中…')).toBeTruthy())
    await waitFor(() => expect(urlsOf(fetchMock, '/agent/stream')).toHaveLength(1))
    // 观察流接管，不再另发 POST /agent
    expect(fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST')).toHaveLength(0)

    act(() => watch.push({ type: 'done', seq: 1, interrupted: null }))
    await waitFor(() => expect(screen.queryByText('规划仍在进行中…')).toBeNull())
    expect(screen.getByRole('button', { name: '发送' })).toBeTruthy()
  })

  it('done 带 interrupted：自动发起一次 {resume:true} 续跑', async () => {
    const { watch, fetchMock } = mockQueuedBackend()
    await sendTurn(fetchMock)

    act(() => watch.push({ type: 'done', seq: 5, interrupted: { at: '2026-09-06T02:10:00.000Z', turnIndex: 2 } }))

    await waitFor(() => {
      const posts = fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST')
      expect(posts).toHaveLength(2)
      expect(bodyOf(posts[1]![1])).toEqual({ resume: true })
    })
  })
})
