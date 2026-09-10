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

// jsdom 没有 scrollIntoView（PlanPlanner 的跟随滚动锚点会调用）
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
  Element.prototype.scrollIntoView = vi.fn() as unknown as typeof Element.prototype.scrollIntoView
  // 自动续跑的「本页会话只试一次」标记，逐条用例隔离
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

describe('PlanPlanner 断线自动续跑（§0 interrupted/resume 契约）', () => {
  const encoder = new TextEncoder()

  function sseResponse(events: unknown[]) {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const event of events) controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
        controller.close()
      },
    })
    return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
  }

  const INTERRUPTED_GET = {
    plan: makePlan(),
    chat: [{ role: 'user', text: '帮我规划' }],
    agentBusy: false,
    interrupted: { at: '2026-09-03T02:00:00.000Z', turnIndex: 3 },
  }

  it('挂载发现 interrupted 非空：自动 POST {resume:true}（不追加用户消息）并显示自动继续横幅', async () => {
    const fetchMock = vi.fn(async (input: unknown, _init?: RequestInit) => {
      const url = String(input)
      // 观察流与 POST 并行开（§0.6 阶段三）：同样挂起（run 进行中）
      if (url.includes('/agent/stream')) return await new Promise<Response>(() => {})
      if (url.includes('/agent')) {
        // resume 回合挂起：便于观察横幅与请求体（run 进行中）
        return await new Promise<Response>(() => {})
      }
      return new Response(JSON.stringify(INTERRUPTED_GET), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <PlanPlanner
        plans={[]}
        planId="plan-1"
        initialPlan={makePlan()}
        initialChat={[{ role: 'user', text: '帮我规划' }]}
      />,
    )

    await waitFor(() =>
      expect(screen.getByText(/上次规划被打断（页面刷新或网络中断），正在自动继续/)).toBeTruthy(),
    )
    const agentCalls = fetchMock.mock.calls.filter(
      ([url]) => String(url).includes('/agent') && !String(url).includes('/agent/stream'),
    )
    expect(agentCalls).toHaveLength(1)
    expect(JSON.parse(String(agentCalls[0]![1]?.body))).toEqual({ resume: true })
    // resume 不追加 human 消息：聊天流里仍只有一条用户气泡
    expect(screen.getAllByText('帮我规划')).toHaveLength(1)
  })

  it('resume 返回 nothing_to_resume：只提示「上次对话已完成」，不再重试', async () => {
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input)
      if (url.includes('/agent/stream')) return await new Promise<Response>(() => {})
      if (url.includes('/agent')) {
        return new Response(JSON.stringify({ ok: false, reason: 'nothing_to_resume' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response(JSON.stringify(INTERRUPTED_GET), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <PlanPlanner
        plans={[]}
        planId="plan-1"
        initialPlan={makePlan()}
        initialChat={[{ role: 'user', text: '帮我规划' }, { role: 'assistant', text: '行程已完成。' }]}
      />,
    )

    await waitFor(() => expect(screen.getByText('上次对话已完成')).toBeTruthy())
    // 自动继续横幅被结果提示替换，且不会再次发起 /agent 请求
    await waitFor(() => expect(screen.queryByText(/正在自动继续/)).toBeNull())
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).includes('/agent') && !String(url).includes('/agent/stream')),
    ).toHaveLength(1)
  })

  it('本会话已自动续跑过（sessionStorage 已记录）：不重复 POST，改由用户手动点「继续」', async () => {
    window.sessionStorage.setItem('planAutoResume:plan-1', 'plan-1:3')
    const fetchMock = vi.fn(async (input: unknown, _init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/agent/stream')) return await new Promise<Response>(() => {})
      if (url.includes('/agent')) return sseResponse([{ type: 'done' }])
      return new Response(JSON.stringify(INTERRUPTED_GET), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <PlanPlanner
        plans={[]}
        planId="plan-1"
        initialPlan={makePlan()}
        initialChat={[{ role: 'user', text: '帮我规划' }]}
      />,
    )

    // 不自动 POST：显示带「继续」按钮的横幅
    await waitFor(() => expect(screen.getByRole('button', { name: '继续' })).toBeTruthy())
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/agent'))).toHaveLength(0)

    // 用户手动点击后才发起 resume 回合
    fireEvent.click(screen.getByRole('button', { name: '继续' }))
    await waitFor(() => {
      const agentCalls = fetchMock.mock.calls.filter(
        ([url]) => String(url).includes('/agent') && !String(url).includes('/agent/stream'),
      )
      expect(agentCalls).toHaveLength(1)
      expect(JSON.parse(String(agentCalls[0]![1]?.body))).toEqual({ resume: true })
    })
  })

  it('观察流 done 带回中断标记：ThinkingChain 显示「已中断」并自动续跑', async () => {
    // §0.6.3：刷新后仍在跑 → 观察流接管；run 被打断时 done 带 interrupted
    const encoderLocal = new TextEncoder()
    let watchController: ReadableStreamDefaultController<Uint8Array> | null = null
    const watchResponse = new Response(
      new ReadableStream<Uint8Array>({
        start(c) {
          watchController = c
        },
      }),
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
    )
    const pushWatch = (event: unknown) =>
      watchController!.enqueue(encoderLocal.encode(`data: ${JSON.stringify(event)}\n\n`))

    const fetchMock = vi.fn(async (input: unknown, _init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/agent/stream')) return watchResponse
      // 自动续跑的 resume 请求挂起：观察中断定格帧
      if (url.includes('/agent')) return await new Promise<Response>(() => {})
      // 挂载核对：run 仍在跑且携带实况
      return new Response(
        JSON.stringify({
          plan: makePlan(),
          chat: [{ role: 'user', text: '帮我规划宇治巡礼' }],
          agentBusy: true,
          live: {
            runToken: 'run-1',
            reasoning: '整理点位中',
            statusText: '查询点位中',
            toolCalls: [],
            updatedAt: '2026-09-03T02:00:00.000Z',
          },
        }),
        { status: 200 },
      )
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<PlanPlanner plans={[]} planId="plan-1" initialPlan={makePlan()} initialChat={[]} />)

    // 进行中：横幅 + 实况短语（确认此时仍是正常进行中态）
    await waitFor(() => expect(screen.getByText('规划仍在进行中…')).toBeTruthy())
    expect(screen.getByText('查询点位中')).toBeTruthy()
    await waitFor(() =>
      expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/agent/stream'))).toHaveLength(1),
    )

    // 观察流收尾：run 被客户端断开/软截止打断（done 带 interrupted 标记）
    act(() => pushWatch({ type: 'done', seq: 1, interrupted: { at: '2026-09-03T02:05:00.000Z', turnIndex: 4 } }))

    // 中断定格：续跑回合的思维链兜底短语变为「已中断」，并进入自动续跑
    await waitFor(() => expect(screen.getByText('已中断')).toBeTruthy())
    expect(screen.queryByText('规划师思考中…')).toBeNull()
    await waitFor(() => expect(screen.getByText(/正在自动继续/)).toBeTruthy())
    const agentCalls = fetchMock.mock.calls.filter(
      ([url]) => String(url).includes('/agent') && !String(url).includes('/agent/stream'),
    )
    expect(JSON.parse(String(agentCalls[0]![1]?.body))).toEqual({ resume: true })
  })
})
