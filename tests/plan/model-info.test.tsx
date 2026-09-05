import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

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

const encoder = new TextEncoder()

/** 只推给定事件、不关闭流（run 仍在跑，思维链保持 active） */
function openSse(events: unknown[]) {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
    },
  })
  return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
}

async function renderWithModelInfo(events: unknown[]) {
  const fetchMock = vi.fn(async (input: unknown) => {
    const url = String(input)
    if (url.includes('/agent')) return openSse(events)
    return new Response(JSON.stringify({ plan: makePlan(), chat: [], agentBusy: false, interrupted: null }), {
      status: 200,
    })
  })
  vi.stubGlobal('fetch', fetchMock)
  render(<PlanPlanner plans={[]} planId="plan-1" initialPlan={makePlan()} initialChat={[]} />)
  fireEvent.change(screen.getByPlaceholderText(/告诉规划师/), { target: { value: '帮我规划' } })
  fireEvent.click(screen.getByRole('button', { name: '发送' }))
}

describe('B2 model_info 思考内容口径提示（§0 契约）', () => {
  it('reasoning=false：思维链头部提示当前模型不公开思考过程', async () => {
    await renderWithModelInfo([
      { type: 'model_info', providerName: 'freecode', model: 'gpt-5.6-sol', reasoning: false },
      { type: 'status', phase: '正在获取点位列表' },
    ])
    await waitFor(() =>
      expect(
        screen.getByText(/当前模型（freecode · gpt-5\.6-sol）不公开思考过程，这里只显示工具进度/),
      ).toBeTruthy(),
    )
  })

  it('reasoning=true：不显示提示', async () => {
    await renderWithModelInfo([
      { type: 'model_info', providerName: 'deepseek', model: 'deepseek-reasoner', reasoning: true },
      { type: 'status', phase: '正在获取点位列表' },
    ])
    await waitFor(() => expect(screen.getByText('正在获取点位列表')).toBeTruthy())
    expect(screen.queryByText(/不公开思考过程/)).toBeNull()
  })
})
