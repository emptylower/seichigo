import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react'

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

/** §0.6 只读观察流：可手动推帧的 SSE 响应 */
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
      <PlanPlanner plans={[]} planId="plan-1" initialPlan={makePlan(['大吉山'])} initialChat={initialChat} />,
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
        plans={[]}
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
        plans={[]}
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

  it('DaymapCard「交给规划师调整」→ 预填输入框（含「基于」前缀）并聚焦，不自动发送', () => {
    render(
      <PlanPlanner
        plans={[]}
        planId="plan-1"
        initialPlan={makePlan(['大吉山'])}
        initialChat={[{ role: 'assistant', text: '', daymap: makeDaymap('rev-draft', '宇治桥') }]}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '交给规划师调整这一天' }))
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    expect(textarea.value).toContain('基于 ')
    expect(textarea.value).toContain('那版行程，请调整第 1 天的安排：')
    expect(document.activeElement).toBe(textarea)
    // 不自动发送：值保留、未清空
    expect(textarea.value).not.toBe('')
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
      <PlanPlanner plans={[]} planId="plan-1" initialPlan={plan} initialChat={[]} />,
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
      <PlanPlanner plans={[]} planId="plan-1" initialPlan={makePlan([])} initialChat={[]} />,
    )

    fireEvent.change(screen.getByPlaceholderText(/告诉规划师/), { target: { value: '帮我规划' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))

    await waitFor(() => {
      expect(screen.getByText('自驾/租车')).toBeTruthy()
    })
    // 意见卡语义：对话流内无图片、无 3:4 封面（侧栏站点区的 Logo img 不在断言范围）
    const chatColumn = container.querySelector('.max-w-3xl') as HTMLElement
    expect(within(chatColumn).queryByRole('img')).toBeNull()
    expect(container.innerHTML).not.toContain('aspect-[3/4]')
    expect(screen.getByText('公共交通')).toBeTruthy()
    expect(screen.getByRole('button', { name: /其他（自行输入）/ })).toBeTruthy()
    // 待回答 ask：全局输入框切到自定义回答占位文案
    expect(screen.getByPlaceholderText(/直接输入你的回答/)).toBeTruthy()
  })
})

describe('PlanPlanner 断线恢复与运行状态', () => {
  const encoder = new TextEncoder()

  function sseFrame(event: unknown): Uint8Array {
    return encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
  }

  it('读流中断进入恢复轮询：横幅出现、已渲染聊天与思维链保留、轮询补齐服务端条目后恢复输入', async () => {
    // 流在两帧（reasoning + text）后抛网络错误，模拟断线（pull 驱动逐帧投递，
    // 避免 error() 丢弃队列中未读的 chunk）
    const frames = [
      sseFrame({ type: 'reasoning', delta: '先想一想' }),
      sseFrame({ type: 'text', text: '前半段' }),
    ]
    let frameIndex = 0
    const brokenStream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (frameIndex < frames.length) {
          controller.enqueue(frames[frameIndex++]!)
          return
        }
        controller.error(new TypeError('network'))
      },
    })

    let agentCalled = false
    let pollCount = 0
    let resolveFirstPoll: ((res: Response) => void) | null = null
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input)
      if (url.includes('/agent')) {
        agentCalled = true
        return new Response(brokenStream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
      }
      if (!agentCalled) {
        // 首挂载核对：空闲
        return new Response(JSON.stringify({ plan: makePlan([]), chat: [], agentBusy: false }), { status: 200 })
      }
      pollCount += 1
      if (pollCount === 1) {
        // 第一次恢复轮询挂起：先让横幅可观测，再由测试放行
        return await new Promise<Response>((resolve) => {
          resolveFirstPoll = resolve
        })
      }
      return new Response(JSON.stringify({ plan: makePlan([]), chat: [], agentBusy: false }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<PlanPlanner plans={[]} planId="plan-1" initialPlan={makePlan([])} initialChat={[]} />)

    fireEvent.change(screen.getByPlaceholderText(/告诉规划师/), { target: { value: '继续' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))

    // 断线横幅出现；已渲染的聊天与思维链保留；busy 仍为 true（输入不可用）
    await waitFor(() => expect(screen.getByText('连接中断，正在同步进度…')).toBeTruthy())
    expect(screen.getByText('前半段')).toBeTruthy()
    expect(screen.getByText('查看思考过程')).toBeTruthy()
    fireEvent.change(screen.getByPlaceholderText(/告诉规划师/), { target: { value: '还在跑吗' } })
    // B1：busy 期间发送按钮位置换成「停止」，此时无法发送
    expect(screen.queryByRole('button', { name: '发送' })).toBeNull()
    expect(screen.getByRole('button', { name: '停止' })).toBeTruthy()

    // 放行第一次轮询：服务端已落库 user + 前半段 + 断线期间补完的条目，agentBusy=false
    resolveFirstPoll!(
      new Response(
        JSON.stringify({
          plan: makePlan([]),
          chat: [
            { role: 'user', text: '继续' },
            { role: 'assistant', text: '前半段' },
            { role: 'assistant', text: '后半段（断线期间完成）' },
          ],
          agentBusy: false,
        }),
        { status: 200 },
      ),
    )

    // 只补齐超出本地已知计数的条目（user/前半段不重复），横幅消失、输入恢复
    await waitFor(() => expect(screen.getByText('后半段（断线期间完成）')).toBeTruthy())
    await waitFor(() => expect(screen.queryByText('连接中断，正在同步进度…')).toBeNull())
    expect(screen.getAllByText('前半段')).toHaveLength(1)
    expect(screen.getByRole('button', { name: '发送' })).toHaveProperty('disabled', false)
    // 已渲染的思维链条目仍在
    expect(screen.getByText('查看思考过程')).toBeTruthy()
  })

  it('首挂载发现 agentBusy=true：观察流接管并显示“规划仍在进行中…”，done 后横幅消失', async () => {
    // §0.6.3：刷新后发现服务端仍在跑 → 打开只读观察流（轮询只作兜底）
    const watch = makeWatchStream()
    const fetchMock = vi.fn(async (input: unknown) => {
      if (String(input).includes('/agent/stream')) return watch.response
      // 首挂载核对：另一标签页/刷新中断的 run 仍在跑
      return new Response(
        JSON.stringify({
          plan: makePlan([]),
          chat: [{ role: 'user', text: '之前发的消息' }],
          agentBusy: true,
        }),
        { status: 200 },
      )
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<PlanPlanner plans={[]} planId="plan-1" initialPlan={makePlan([])} initialChat={[]} />)

    // 横幅 + 服务端已有条目补齐 + 观察流已打开
    await waitFor(() => expect(screen.getByText('规划仍在进行中…')).toBeTruthy())
    expect(screen.getByText('之前发的消息')).toBeTruthy()
    await waitFor(() =>
      expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/agent/stream'))).toHaveLength(1),
    )

    // 观察流推 done：run 结束 → 横幅消失、busy 解除
    act(() => watch.push({ type: 'done', seq: 1, interrupted: null }))
    await waitFor(() => expect(screen.queryByText('规划仍在进行中…')).toBeNull())
    fireEvent.change(screen.getByPlaceholderText(/告诉规划师/), { target: { value: '继续规划' } })
    expect(screen.getByRole('button', { name: '发送' })).toHaveProperty('disabled', false)
  })

  it('刷新恢复：挂载核对的 live 实况展示思考内容；观察流 chat + done 后渲染 daymap', async () => {
    const watch = makeWatchStream()
    const fetchMock = vi.fn(async (input: unknown) => {
      if (String(input).includes('/agent/stream')) return watch.response
      // 首挂载核对：run 仍在跑，且携带运行实况（§0.1 契约）
      return new Response(
        JSON.stringify({
          plan: makePlan([]),
          chat: [{ role: 'user', text: '帮我规划宇治巡礼' }],
          agentBusy: true,
          chatRevision: 1,
          live: {
            runToken: 'run-1',
            reasoning: '正在比对宇治桥与大吉山的取景点位…',
            statusText: '查询点位中',
            toolCalls: [{ name: 'list_points', status: 'running', summary: '作品 id 115908' }],
            updatedAt: '2026-09-03T01:00:00.000Z',
          },
        }),
        { status: 200 },
      )
    })
    vi.stubGlobal('fetch', fetchMock)

    const { container } = render(
      <PlanPlanner plans={[]} planId="plan-1" initialPlan={makePlan([])} initialChat={[]} />,
    )

    // 实况：横幅 + 服务端 reasoning/状态短语/工具调用直接展示（不再是空壳）
    await waitFor(() => expect(screen.getByText('规划仍在进行中…')).toBeTruthy())
    await waitFor(() => expect(screen.getByText(/正在比对宇治桥与大吉山的取景点位/)).toBeTruthy())
    expect(screen.getByText('查询点位中')).toBeTruthy()
    expect(screen.getByText('作品 id 115908')).toBeTruthy()
    // 服务端已有条目按整体替换口径补齐
    expect(screen.getByText('帮我规划宇治巡礼')).toBeTruthy()

    // 观察流：chat 全量快照 + done → 渲染 daymap 卡与文本，横幅与实况消失
    act(() =>
      watch.push({
        type: 'chat',
        seq: 1,
        chatRevision: 3,
        chat: [
          { role: 'user', text: '帮我规划宇治巡礼' },
          { role: 'assistant', text: '', daymap: makeDaymap('rev-recover', '宇治桥') },
          { role: 'assistant', text: '行程已保存，刷新后也能看到。' },
        ],
      }),
    )
    await waitFor(() => expect(container.querySelectorAll('[data-daymap-revision="rev-recover"]')).toHaveLength(1))
    expect(screen.getByText('行程已保存，刷新后也能看到。')).toBeTruthy()

    act(() => watch.push({ type: 'done', seq: 2, interrupted: null }))
    await waitFor(() => expect(screen.queryByText('规划仍在进行中…')).toBeNull())
    // 实况思维链随 run 结束消失
    expect(screen.queryByText('查询点位中')).toBeNull()
  })
})

describe('PlanPlanner 重试与空消息守卫', () => {
  function sseErrorResponse(message: string) {
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const event of [{ type: 'error', message }, { type: 'done' }]) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
        }
        controller.close()
      },
    })
    return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
  }

  it('答复轮（带 answerTo）出错后出现“重试”按钮，重试原样回发同样的 answerTo/answerValue', async () => {
    const fetchMock = vi.fn(async (input: unknown, _init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/agent')) return sseErrorResponse('boom')
      return new Response(JSON.stringify({ plan: makePlan([]) }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <PlanPlanner
        plans={[]}
        planId="plan-1"
        initialPlan={makePlan([])}
        initialChat={[
          {
            role: 'assistant',
            text: '想巡礼哪几部？',
            ask: {
              askId: 'ask-work',
              kind: 'multi_choice',
              taskType: 'work_selection',
              prompt: '想巡礼哪几部？',
              options: [
                { id: 'a', label: '吹响吧！上低音号' },
                { id: 'b', label: '轻音少女' },
              ],
            },
          },
        ]}
      />,
    )

    // 通过作品卡提交一条答复轮（带 answerTo/answerValue）
    fireEvent.click(screen.getByRole('button', { name: /轻音少女/ }))
    fireEvent.click(screen.getByRole('button', { name: '确认' }))

    // 答复轮出错后同样给出重试入口
    await waitFor(() => expect(screen.getByText(/出错了：boom/)).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /重试/ }))

    await waitFor(() => {
      const agentCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes('/agent'))
      expect(agentCalls).toHaveLength(2)
    })
    const agentCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes('/agent'))
    const firstBody = JSON.parse(String(agentCalls[0]![1]?.body)) as Record<string, unknown>
    const retryBody = JSON.parse(String(agentCalls[1]![1]?.body)) as Record<string, unknown>
    // 重试原样重发完整请求体
    expect(retryBody).toEqual(firstBody)
    expect(retryBody.answerTo).toBe('ask-work')
    expect(retryBody.answerValue).toEqual({ optionIds: ['b'] })
  })

  it('空 message 不发 fetch，只在聊天流追加本地提示', async () => {
    const fetchMock = vi.fn(async (_input: unknown) => new Response(JSON.stringify({ plan: makePlan([]) }), { status: 200 })
    )
    vi.stubGlobal('fetch', fetchMock)

    render(
      <PlanPlanner
        plans={[]}
        planId="plan-1"
        initialPlan={makePlan([])}
        initialChat={[
          {
            role: 'assistant',
            text: '想巡礼哪一部？',
            ask: {
              askId: 'ask-empty',
              kind: 'single_choice',
              taskType: 'work_selection',
              prompt: '想巡礼哪一部？',
              // 异常数据：选项 label 为空，readableText 拼出来是空串
              options: [{ id: 'x', label: '' }],
            },
          },
        ]}
      />,
    )

    // label 为空的作品卡（可访问名为空）+ 底部确认条
    fireEvent.click(screen.getByRole('button', { name: '' }))
    fireEvent.click(screen.getByRole('button', { name: '确认' }))

    // 追加的 assistant 提示会使上一张 ask 折叠成摘要 chip，同文本出现两处
    await waitFor(() => expect(screen.getAllByText('消息为空，未发送').length).toBeGreaterThan(0))
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/agent'))).toHaveLength(0)
  })
})

describe('PlanPlanner 布局：悬浮输入胶囊（传统 AI Chat 布局）', () => {
  it('标题栏是白底 sticky 条：bg-white + 底边框，不再是透明毛玻璃', () => {
    const { container } = render(
      <PlanPlanner plans={[]} planId="plan-1" initialPlan={makePlan([])} initialChat={[]} />,
    )
    const bar = container.querySelector('.sticky.top-0')!
    expect(bar).toBeTruthy()
    expect(bar.className).toContain('bg-white')
    expect(bar.className).toContain('border-b')
    expect(bar.className).not.toContain('backdrop-blur')
    expect(bar.className).not.toContain('bg-transparent')
  })

  it('标题栏右侧是“回到网站”链接（href=/），不再有待上线的“更多操作”按钮', () => {
    render(<PlanPlanner plans={[]} planId="plan-1" initialPlan={makePlan([])} initialChat={[]} />)
    const home = screen.getByRole('link', { name: '回到网站' })
    expect(home.getAttribute('href')).toBe('/')
    expect(screen.queryByRole('button', { name: '更多操作' })).toBeNull()
  })

  it('输入区是 max-w-3xl 对话列内的悬浮胶囊，不再存在全宽 border-t 白板输入条', () => {
    const { container } = render(
      <PlanPlanner plans={[]} planId="plan-1" initialPlan={makePlan([])} initialChat={[]} />,
    )
    const textarea = screen.getByPlaceholderText(/告诉规划师/)
    // 胶囊本体：圆角 + 描边 + 阴影（rounded-3xl）
    const capsule = textarea.closest('.rounded-3xl')!
    expect(capsule).toBeTruthy()
    // 胶囊在 max-w-3xl 对话列内
    expect(capsule.closest('.max-w-3xl')).toBeTruthy()
    // 不存在全宽 border-t 白板输入条（旧布局的 shrink-0 border-t bg-white/90）
    expect(container.querySelector('[class*="border-t"][class*="bg-white/90"]')).toBeNull()
    // 标题行不再有白色底板的 h-14 顶栏
    expect(container.querySelector('header.h-14')).toBeNull()
  })

  it('textarea 增高不改变胶囊外层包裹容器的类名（只有胶囊自己变高）', () => {
    const { container } = render(
      <PlanPlanner plans={[]} planId="plan-1" initialPlan={makePlan([])} initialChat={[]} />,
    )
    const textarea = screen.getByPlaceholderText(/告诉规划师/)
    const wrapper = textarea.closest('.rounded-3xl')!.parentElement as HTMLElement
    const wrapperClass = wrapper.className
    // 输入多行内容使 textarea 增高
    fireEvent.change(textarea, { target: { value: '第一行\n第二行\n第三行\n第四行\n第五行\n第六行\n第七行' } })
    expect(wrapper.className).toBe(wrapperClass)
  })
})
