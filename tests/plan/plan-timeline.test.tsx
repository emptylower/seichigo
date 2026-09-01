import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

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
  default: (props: { src: string | null; alt: string }) => <div data-testid="resilient-image">{props.alt}</div>,
}))

import { PlanPlanner } from '@/app/(authed)/plan/[id]/ui'
import type { ChatEntryView, DaymapMessagePayload, TripPlanItemView, TripPlanView } from '@/lib/tripPlan/view'

// jsdom 没有 scrollIntoView（PlanPlanner 的跟随滚动锚点会调用）
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
  Element.prototype.scrollIntoView = vi.fn() as unknown as typeof Element.prototype.scrollIntoView
})

function makeItem(title: string): TripPlanItemView {
  return {
    id: `item-${title}`,
    sortOrder: 0,
    type: 'point',
    pointId: `pt-${title}`,
    timeHint: null,
    title,
    note: null,
    reason: null,
    payload: null,
    point: { id: `pt-${title}`, name: title, nameZh: null, lat: 34.8892, lng: 135.8075, image: null },
  }
}

function makeDaymap(revisionId: string, itemTitle: string): DaymapMessagePayload {
  return {
    type: 'daymap',
    revisionId,
    savedAt: '2026-09-01T08:30:00Z',
    days: [{ id: `day-${revisionId}`, dayIndex: 1, date: null, citySlug: null, summary: null, items: [makeItem(itemTitle)] }],
  }
}

function makePlan(itemTitles: string[]): TripPlanView {
  return {
    id: 'plan-1',
    title: '京吹巡礼',
    status: 'draft',
    startDate: null,
    dayCount: itemTitles.length,
    bangumiIds: [115908],
    updatedAt: new Date().toISOString(),
    days: [
      {
        id: 'day-current',
        dayIndex: 1,
        date: null,
        citySlug: null,
        summary: null,
        items: itemTitles.map(makeItem),
      },
    ],
  }
}

function assertBefore(a: Element, b: Element) {
  expect(
    a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING,
    'expected a to appear before b in the DOM',
  ).toBeTruthy()
}

describe('PlanPlanner 聊天时间线（daymap 交付物）', () => {
  it('DOM 顺序覆盖 assistant 解释 → daymap A → ask opinion（折叠摘要）→ user 回答 → daymap B；不再额外渲染固定末尾的当前 DayCards', () => {
    const initialChat: ChatEntryView[] = [
      { role: 'assistant', text: '第一版行程已经保存，请看下面的地图。' },
      { role: 'assistant', text: '', daymap: makeDaymap('rev-a', '宇治桥') },
      {
        role: 'assistant',
        text: '这次山区行程以什么交通方式为主？',
        ask: {
          askId: 'ask-1',
          kind: 'single_choice',
          taskType: 'opinion',
          prompt: '这次山区行程以什么交通方式为主？',
          options: [
            { id: 'car', label: '自驾/租车', preferenceOnly: true },
            { id: '__custom__', label: '其他（自行输入）' },
          ],
        },
      },
      { role: 'user', text: '自驾吧' },
      { role: 'assistant', text: '', daymap: makeDaymap('rev-b', '大吉山') },
    ]
    const { container } = render(
      <PlanPlanner planId="plan-1" initialPlan={makePlan(['大吉山'])} initialChat={initialChat} />,
    )

    const explain = screen.getByText('第一版行程已经保存，请看下面的地图。')
    const daymapA = container.querySelector('[data-daymap-revision="rev-a"]')!
    // ask 折叠摘要 chip 会显示同一段回答文本 → '自驾吧' 出现两次（chip + 用户气泡）；
    // chip（bg-brand-50 圆角条）在前，用户气泡在后
    const replyNodes = screen.getAllByText('自驾吧')
    expect(replyNodes.length).toBe(2)
    const askChip = replyNodes[0]!.closest('.bg-brand-50')!
    const userReply = replyNodes[1]!
    const daymapB = container.querySelector('[data-daymap-revision="rev-b"]')!

    expect(daymapA).not.toBeNull()
    expect(daymapB).not.toBeNull()
    assertBefore(explain, daymapA)
    assertBefore(daymapA, askChip)
    assertBefore(askChip, userReply)
    assertBefore(userReply, daymapB)

    // 已有真实 daymap 消息 → 不再渲染固定在列表末尾的"当前计划"副本
    // （当前计划副本带"保存到我的地图"；两张快照都是只读的）
    expect(screen.queryByText('保存到我的地图')).toBeNull()
    expect(container.querySelectorAll('[data-daymap-revision]')).toHaveLength(2)
  })

  it('无历史 daymap 的存量计划：仅当 chat 无 daymap 且当前 plan 有 days 时渲染一次 legacy 当前交付物', () => {
    const { container } = render(
      <PlanPlanner
        planId="plan-1"
        initialPlan={makePlan(['宇治桥'])}
        initialChat={[
          { role: 'user', text: '帮我规划' },
          { role: 'assistant', text: '安排好了。' },
        ]}
      />,
    )
    expect(container.querySelectorAll('[data-daymap-revision]')).toHaveLength(0)
    expect(screen.getAllByText('保存到我的地图')).toHaveLength(1)
    expect(screen.getByText('宇治桥')).toBeTruthy()
  })

  it('chat 中出现任何 daymap 后，legacy 副本立即消失（哪怕当前 plan 仍有 days）', () => {
    render(
      <PlanPlanner
        planId="plan-1"
        initialPlan={makePlan(['大吉山'])}
        initialChat={[
          { role: 'assistant', text: '', daymap: makeDaymap('rev-only', '宇治桥') },
        ]}
      />,
    )
    expect(screen.queryByText('保存到我的地图')).toBeNull()
    expect(screen.getByText('宇治桥')).toBeTruthy()
  })
})

describe('PlanPlanner 实时 SSE 路径', () => {
  function sseResponse(events: unknown[]) {
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const event of events) controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
        controller.close()
      },
    })
    return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
  }

  it('收到 daymap 事件按 revision 去重后插入时间线；重复 revision 不重复渲染；plan_updated 刷新当前计划', async () => {
    const plan = makePlan(['旧安排'])
    const daymapEvent = {
      type: 'daymap',
      ...(makeDaymap('rev-live', '宇治桥') as object),
    }
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input)
      if (url.includes('/agent')) {
        return sseResponse([
          { type: 'ready' },
          { type: 'text', text: '安排好了！' },
          { type: 'plan_updated' },
          daymapEvent,
          daymapEvent, // 模拟客户端重连/事件重放：同一 revision 重复下发
          { type: 'done' },
        ])
      }
      // refreshPlan 的 GET
      return new Response(JSON.stringify({ plan }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const { container } = render(
      <PlanPlanner planId="plan-1" initialPlan={plan} initialChat={[]} />,
    )

    fireEvent.change(screen.getByPlaceholderText(/告诉规划师/), { target: { value: '安排一天宇治巡礼' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))

    await waitFor(() => {
      expect(container.querySelectorAll('[data-daymap-revision="rev-live"]')).toHaveLength(1)
    })
    await waitFor(() => {
      expect(screen.getByText('安排好了！')).toBeTruthy()
    })
    // 去重：同一 revision 只有一张快照；legacy 副本被真实 daymap 顶掉
    expect(container.querySelectorAll('[data-daymap-revision]')).toHaveLength(1)
    expect(screen.queryByText('保存到我的地图')).toBeNull()
    // plan_updated → refreshPlan 走了 GET
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/api/me/plans/plan-1'))).toBe(true)
  })

  it('实时 ask 事件携带 taskType=opinion：渲染文本意见卡而非作品封面卡', async () => {
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input)
      if (url.includes('/agent')) {
        return sseResponse([
          { type: 'ready' },
          {
            type: 'ask',
            askId: 'ask-live',
            kind: 'single_choice',
            taskType: 'opinion',
            prompt: '这次山区行程以什么交通方式为主？',
            options: [
              { id: 'car', label: '自驾/租车', sublabel: '山区公交班次少', preferenceOnly: true },
              { id: 'transit', label: '公共交通', preferenceOnly: true },
              { id: '__custom__', label: '其他（自行输入）' },
            ],
          },
          { type: 'done' },
        ])
      }
      return new Response(JSON.stringify({ plan: makePlan([]) }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const { container } = render(
      <PlanPlanner planId="plan-1" initialPlan={makePlan([])} initialChat={[]} />,
    )

    fireEvent.change(screen.getByPlaceholderText(/告诉规划师/), { target: { value: '帮我规划' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))

    await waitFor(() => {
      expect(screen.getByText('自驾/租车')).toBeTruthy()
    })
    // 意见卡语义：无图片、无 3:4 封面
    expect(container.querySelector('img')).toBeNull()
    expect(container.innerHTML).not.toContain('aspect-[3/4]')
    expect(screen.getByText('公共交通')).toBeTruthy()
    expect(screen.getByRole('button', { name: /其他（自行输入）/ })).toBeTruthy()
    // 待回答 ask：全局输入框切到自定义回答占位文案
    expect(screen.getByPlaceholderText(/直接输入你的回答/)).toBeTruthy()
  })
})
