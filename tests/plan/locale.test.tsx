import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

// PlanPlanner / DayCards 依赖链的轻量桩：Link 需要 app router 上下文，地图/图片是重依赖
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
vi.mock('next/dynamic', async () => (await import('./helpers/nextDynamicSync')).syncDynamicMock())
vi.mock('@/components/route/RoutePreviewMap', () => ({
  RoutePreviewMap: () => <div data-testid="route-map" />,
}))
vi.mock('@/components/map/ResilientMapImage', () => ({
  default: (props: { src: string | null; alt: string }) => (
    <img data-testid="resilient-image" data-src={props.src ?? ''} alt={props.alt} />
  ),
}))

import { AskCard } from '@/app/(authed)/plan/[id]/components/AskCard'
import { ChatPane } from '@/app/(authed)/plan/[id]/components/ChatPane'
import { DayCards } from '@/app/(authed)/plan/[id]/components/DayCards'
import { DayMap } from '@/app/(authed)/plan/[id]/components/DayMap'
import { DayMapExpanded } from '@/app/(authed)/plan/[id]/components/DayMapExpanded'
import { DayPointCard } from '@/app/(authed)/plan/[id]/components/DayPointCard'
import { ItemThumbnail } from '@/app/(authed)/plan/[id]/components/ItemThumbnail'
import { PlanComposer } from '@/app/(authed)/plan/[id]/components/PlanComposer'
import { PlanSidebar } from '@/app/(authed)/plan/[id]/components/PlanSidebar'
import { ThinkingChain, type ThinkingTurn } from '@/app/(authed)/plan/[id]/components/ThinkingChain'
import { TransitConnector } from '@/app/(authed)/plan/[id]/components/TransitConnector'
import { PlanPlanner } from '@/app/(authed)/plan/[id]/ui'
import type { ChatEntry } from '@/app/(authed)/plan/[id]/lib/chatState'
import type { TripPlanDayView, TripPlanItemView, TripPlanView } from '@/lib/tripPlan/view'

/** 设计稿 §测试：英文站渲染出的界面文案不得含中日文字（点位名/用户内容除外，见 fixture） */
const CJK = /[一-龥぀-ヿ]/

/** 界面上真正给人看的文本：可见文字 + 无障碍/提示类属性 */
function visibleText(container: HTMLElement): string {
  const parts = [container.textContent ?? '']
  for (const el of Array.from(container.querySelectorAll('*'))) {
    for (const attr of ['aria-label', 'title', 'placeholder', 'alt']) {
      const value = el.getAttribute(attr)
      if (value) parts.push(value)
    }
  }
  return parts.join(' | ')
}

function expectNoCjk(container: HTMLElement) {
  const text = visibleText(container)
  const hit = text.split('|').find((chunk) => CJK.test(chunk))
  expect(hit ?? '', `英文站残留中日文文案：${hit ?? ''}`).toBe('')
}

// ---------- fixtures（全 ASCII，避免和"界面文案"混淆） ----------

function item(partial: Partial<TripPlanItemView>): TripPlanItemView {
  return {
    id: partial.id ?? `item-${Math.random().toString(36).slice(2)}`,
    sortOrder: partial.sortOrder ?? 0,
    type: partial.type ?? 'point',
    pointId: partial.pointId ?? null,
    timeHint: partial.timeHint ?? null,
    title: partial.title ?? 'Uji Bridge',
    note: partial.note ?? null,
    reason: partial.reason ?? null,
    payload: partial.payload ?? null,
    point: partial.point ?? null,
  }
}

const POINT = { id: 'pt-1', name: 'Uji Bridge', nameZh: null, lat: 34.8892, lng: 135.8075, image: null }

function day(): TripPlanDayView {
  return {
    id: 'day-1',
    dayIndex: 1,
    date: '2026-09-05',
    citySlug: null,
    summary: null,
    items: [
      item({
        id: 'i1',
        title: 'Uji Bridge',
        pointId: 'pt-1',
        point: POINT,
        payload: { schedule: { start: '09:00', end: '10:00', confidence: 'estimated' } },
      }),
      item({
        id: 'i2',
        type: 'transit',
        title: 'transfer',
        payload: {
          transport: {
            mode: 'transit',
            durationMin: 26,
            distanceKm: 5.4,
            transfers: 1,
            legs: [
              { mode: 'walk', durationMin: 5, distanceKm: 0.4 },
              { mode: 'transit', durationMin: 18, line: 'Keihan Line', fromStop: 'Uji', toStop: 'Chushojima', numStops: 4 },
            ],
          },
        },
      }),
      item({ id: 'i3', type: 'meal', title: 'Lunch' }),
      item({
        id: 'i4',
        type: 'attraction',
        title: 'Byodoin',
        payload: { place: { placeId: 'g1', name: 'Byodoin', lat: 34.889, lng: 135.807 } },
      }),
    ],
  }
}

function plan(): TripPlanView {
  return {
    id: 'plan-1',
    title: 'Kyoto pilgrimage',
    status: 'draft',
    startDate: null,
    dayCount: 1,
    bangumiIds: [],
    updatedAt: '2026-09-05T00:00:00Z',
    days: [day()],
  }
}

const THINKING: ThinkingTurn = {
  reasoning: 'group the spots by area',
  statusPhrase: null,
  toolCalls: [{ id: 'c1', name: 'list_points', argsSummary: 'bangumi 115908', status: 'done', durationMs: 738 }],
  startedAt: 0,
  endedAt: 12_000,
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })))
  Element.prototype.scrollIntoView = vi.fn() as unknown as typeof Element.prototype.scrollIntoView
})

describe('ThinkingChain', () => {
  it('en：进行中兜底短语与定格摘要都是英文', () => {
    const { container, rerender } = render(
      <ThinkingChain
        thinking={{ reasoning: '', statusPhrase: null, toolCalls: [], startedAt: 0 }}
        active
        expanded={false}
        onToggle={() => {}}
        locale="en"
        modelNotice={{ providerName: 'Zhipu', model: 'glm' }}
      />,
    )
    expect(screen.getByText('The planner is thinking…')).toBeTruthy()
    expectNoCjk(container)

    rerender(<ThinkingChain thinking={THINKING} active={false} expanded={false} onToggle={() => {}} locale="en" />)
    expect(screen.getByText(/Done in 1 steps/)).toBeTruthy()
    expect(screen.getByText('View reasoning')).toBeTruthy()
    expectNoCjk(container)
  })

  it('ja：兜底短语与「思考過程を見る」', () => {
    render(<ThinkingChain thinking={THINKING} active={false} expanded={false} onToggle={() => {}} locale="ja" />)
    expect(screen.getByText('思考過程を見る')).toBeTruthy()
  })

  it('停止定格：站点语言换了也认得出「已停止」（三语任一命中）', () => {
    render(
      <ThinkingChain
        thinking={{ reasoning: '', statusPhrase: 'Stopped', toolCalls: [], startedAt: 0, endedAt: 1000 }}
        active={false}
        expanded={false}
        onToggle={() => {}}
        locale="ja"
      />,
    )
    expect(screen.getByText(/停止しました/)).toBeTruthy()
  })
})

describe('PlanComposer', () => {
  it('en：placeholder 与发送/停止 aria-label 都是英文', () => {
    const { container } = render(
      <PlanComposer
        value=""
        onChange={() => {}}
        onSend={() => {}}
        busy={false}
        answering={false}
        stopRequested={false}
        onStop={() => {}}
        locale="en"
      />,
    )
    expect(screen.getByRole('button', { name: 'Send' })).toBeTruthy()
    expectNoCjk(container)
  })

  it('en：待回答的 ask 在场时换成自定义回答 placeholder', () => {
    const { container } = render(
      <PlanComposer
        value=""
        onChange={() => {}}
        onSend={() => {}}
        busy
        answering
        stopRequested={false}
        onStop={() => {}}
        locale="en"
      />,
    )
    expect(screen.getByPlaceholderText('Type your own answer to this question… (Enter to send)')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy()
    expectNoCjk(container)
  })

  it('en/ja：402 提示条的升级按钮三语且链接带语言前缀', () => {
    const notice = { message: 'Monthly usage is used up.', upgradeAvailable: true }
    const en = render(
      <PlanComposer
        value=""
        onChange={() => {}}
        onSend={() => {}}
        busy={false}
        answering={false}
        stopRequested={false}
        onStop={() => {}}
        budgetNotice={notice}
        locale="en"
      />,
    )
    expect(screen.getByRole('link', { name: 'Upgrade' })).toHaveAttribute('href', '/en/pricing')
    expectNoCjk(en.container)
    en.unmount()

    render(
      <PlanComposer
        value=""
        onChange={() => {}}
        onSend={() => {}}
        busy={false}
        answering={false}
        stopRequested={false}
        onStop={() => {}}
        budgetNotice={{ message: '今月の利用量を使い切りました。', upgradeAvailable: true }}
        locale="ja"
      />,
    )
    expect(screen.getByRole('link', { name: 'アップグレード' })).toHaveAttribute('href', '/ja/pricing')
  })

  it('ja：送信ボタン', () => {
    render(
      <PlanComposer
        value=""
        onChange={() => {}}
        onSend={() => {}}
        busy={false}
        answering={false}
        stopRequested={false}
        onStop={() => {}}
        locale="ja"
      />,
    )
    expect(screen.getByRole('button', { name: '送信' })).toBeTruthy()
  })
})

describe('ChatPane', () => {
  const chat: ChatEntry[] = [
    { role: 'assistant', text: 'here is the plan', retry: { message: 'again' } },
  ]

  it('en：三种横幅 + 重试 + 进行中兜底短语都是英文', () => {
    const { container } = render(
      <ChatPane
        planId="plan-1"
        chat={chat}
        days={[]}
        busy
        syncBanner="reconnecting"
        stopped
        onResumeAfterStop={() => {}}
        resumeBanner="manual"
        onResume={() => {}}
        expandedThinking={null}
        onToggleHistoryThinking={() => {}}
        activeThinking={null}
        activeExpanded={false}
        onToggleActiveThinking={() => {}}
        interrupted
        modelNotice={null}
        onComposeDraft={() => {}}
        onAnswerAsk={() => {}}
        onRetry={() => {}}
        chatEndRef={{ current: null }}
        locale="en"
      />,
    )
    expect(screen.getByText('Connection lost. Syncing progress…')).toBeTruthy()
    expect(screen.getByText(/This planning round was stopped\./)).toBeTruthy()
    expect(screen.getByText('Interrupted')).toBeTruthy()
    expect(screen.getByText('Retry')).toBeTruthy()
    expectNoCjk(container)
  })

  it('en：空对话展示英文示例句', () => {
    const { container } = render(
      <ChatPane
        planId="plan-1"
        chat={[]}
        days={[]}
        busy={false}
        syncBanner={null}
        stopped={false}
        onResumeAfterStop={() => {}}
        resumeBanner="done"
        onResume={() => {}}
        expandedThinking={null}
        onToggleHistoryThinking={() => {}}
        activeThinking={null}
        activeExpanded={false}
        onToggleActiveThinking={() => {}}
        interrupted={false}
        modelNotice={null}
        onComposeDraft={() => {}}
        onAnswerAsk={() => {}}
        onRetry={() => {}}
        chatEndRef={{ current: null }}
        locale="en"
      />,
    )
    expect(screen.getByText('The last conversation already finished')).toBeTruthy()
    expectNoCjk(container)
  })

  it('ja：停止横幅と「続ける」', () => {
    render(
      <ChatPane
        planId="plan-1"
        chat={[]}
        days={[]}
        busy={false}
        syncBanner={null}
        stopped
        onResumeAfterStop={() => {}}
        resumeBanner={null}
        onResume={() => {}}
        expandedThinking={null}
        onToggleHistoryThinking={() => {}}
        activeThinking={null}
        activeExpanded={false}
        onToggleActiveThinking={() => {}}
        interrupted={false}
        modelNotice={null}
        onComposeDraft={() => {}}
        onAnswerAsk={() => {}}
        onRetry={() => {}}
        chatEndRef={{ current: null }}
        locale="ja"
      />,
    )
    expect(screen.getByText(/今回のプラン作成を停止しました。/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /続ける/ })).toBeTruthy()
  })
})

describe('PlanSidebar', () => {
  const plans = [
    { id: 'p1', title: 'Kyoto trip', updatedAt: new Date().toISOString() },
    { id: 'p2', title: '未命名巡礼计划', updatedAt: new Date(Date.now() - 86_400_000).toISOString() },
  ]

  it('en：站点导航、新建对话、今天/昨天都是英文', () => {
    const { container } = render(
      <PlanSidebar plans={plans} currentPlanId="p1" mobileOpen onCloseMobile={() => {}} locale="en" />,
    )
    expect(screen.getAllByText('New chat').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Untitled chat').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Yesterday').length).toBeGreaterThan(0)
    expectNoCjk(container)
  })

  it('ja：新しいチャット', () => {
    render(<PlanSidebar plans={[]} currentPlanId="p1" mobileOpen={false} onCloseMobile={() => {}} locale="ja" />)
    expect(screen.getByText('新しいチャット')).toBeTruthy()
    expect(screen.getByText('まだチャットがありません')).toBeTruthy()
  })
})

describe('AskCard', () => {
  it('en：日期卡（精确 + 大概）全英文，readableText 也是英文', () => {
    const onSubmit = vi.fn()
    const { container } = render(
      <AskCard
        payload={{ askId: 'a1', kind: 'date_range', taskType: 'date_range', prompt: 'When do you leave?', allowSkip: true }}
        onSubmit={onSubmit}
        locale="en"
      />,
    )
    expect(screen.getByText('Exact dates')).toBeTruthy()
    expect(screen.getByText('Pick a departure date')).toBeTruthy()
    expectNoCjk(container)

    fireEvent.click(screen.getByText('Rough timing'))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(String(onSubmit.mock.calls[0]?.[0]?.readableText)).toMatch(/^Leaving around next month for 3 days$/)
    expectNoCjk(container)
  })

  it('en：作品选择卡的「已选 N 项 / 确认」是英文', () => {
    const { container } = render(
      <AskCard
        payload={{
          askId: 'a2',
          kind: 'multi_choice',
          taskType: 'work_selection',
          prompt: 'Which anime?',
          options: [{ id: 'o1', label: 'Sound! Euphonium' }],
        }}
        onSubmit={() => {}}
        locale="en"
      />,
    )
    expect(screen.getByText('0 selected')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeTruthy()
    expectNoCjk(container)
  })

  it('en：意见卡的自定义输入与提交按钮是英文', () => {
    const { container } = render(
      <AskCard
        payload={{
          askId: 'a3',
          kind: 'single_choice',
          taskType: 'opinion',
          prompt: 'Which travel mode?',
          options: [{ id: 'o1', label: 'Drive' }],
        }}
        onSubmit={() => {}}
        locale="en"
      />,
    )
    fireEvent.click(screen.getByText('Other (type your own)'))
    expect(screen.getByPlaceholderText('Type your answer…')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Submit' })).toBeTruthy()
    expectNoCjk(container)
  })

  it('ja：日付カードの「日付を指定」', () => {
    render(
      <AskCard
        payload={{ askId: 'a4', kind: 'date_range', taskType: 'date_range', prompt: 'いつ出発しますか？' }}
        onSubmit={() => {}}
        locale="ja"
      />,
    )
    expect(screen.getByText('日付を指定')).toBeTruthy()
    expect(screen.getByText('だいたいの時期')).toBeTruthy()
  })
})

describe('DayCards / TransitConnector / ItemThumbnail', () => {
  it('en：类型标签、交通摘要、保存按钮、整日导航都是英文', () => {
    const { container } = render(<DayCards planId="plan-1" days={[day()]} scope="current" locale="en" />)
    expect(screen.getByText('Save to my map')).toBeTruthy()
    expect(screen.getByText('Meal')).toBeTruthy()
    expect(screen.getByText('Google place')).toBeTruthy()
    expect(screen.getAllByText('Est.').length).toBeGreaterThan(0)
    expect(screen.getByText('Navigate the day')).toBeTruthy()
    // 归并摘要：先步行 5 分钟，再乘车 18 分钟
    expect(screen.getByText('first Walk 5 min, then Transit 18 min')).toBeTruthy()
    expectNoCjk(container)
  })

  it('en：「交给规划师调整」预填文案是英文', () => {
    const onComposeDraft = vi.fn()
    render(<DayCards planId="plan-1" days={[day()]} scope="current" onComposeDraft={onComposeDraft} locale="en" />)
    fireEvent.click(screen.getByText('Ask the planner to adjust this day'))
    expect(onComposeDraft).toHaveBeenCalledWith('Please adjust the plan for day 1:')
  })

  it('en：切到地图 tab 后的展开/示意标注是英文', () => {
    const { container } = render(<DayCards planId="plan-1" days={[day()]} scope="current" locale="en" />)
    fireEvent.click(screen.getByText('Map'))
    expect(screen.getByText('Expand')).toBeTruthy()
    expectNoCjk(container)
  })

  it('ja：リスト/地図タブと「マイマップに保存」', () => {
    render(<DayCards planId="plan-1" days={[day()]} scope="current" locale="ja" />)
    expect(screen.getByText('リスト')).toBeTruthy()
    expect(screen.getByText('マイマップに保存')).toBeTruthy()
  })

  it('en：交通抽屉展开后的逐步指引与总计是英文', () => {
    const transit = day().items[1]!
    const { container } = render(<TransitConnector item={transit} locale="en" />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText(/Take Keihan Line/)).toBeTruthy()
    expect(screen.getByText(/26 min in total/)).toBeTruthy()
    expectNoCjk(container)
  })

  it('en：缩略图的 neighbor 角标是英文', () => {
    const { container } = render(
      <ItemThumbnail
        image={null}
        alt="Uji Bridge"
        fallbackSrc={null}
        media={{ source: 'neighbor' }}
        locale="en"
      />,
    )
    expect(screen.getByText('Ref.')).toBeTruthy()
    expectNoCjk(container)
  })
})

describe('DayMap / DayMapExpanded / DayPointCard', () => {
  it('en：无坐标点位的空态是英文', () => {
    const emptyDay: TripPlanDayView = { ...day(), items: [item({ id: 'x', title: 'Nowhere' })] }
    const { container } = render(<DayMap planId="plan-1" day={emptyDay} locale="en" />)
    expect(screen.getByText('No mapped spots for this day yet')).toBeTruthy()
    expectNoCjk(container)
  })

  it('en/ja：全屏展开态的标题', () => {
    const { container, unmount } = render(
      <DayMapExpanded dayIndex={2} points={[]} routeGeometry={null} onClose={() => {}} locale="en" />,
    )
    expect(screen.getByRole('heading', { name: 'Day 2 · Route' })).toBeTruthy()
    expectNoCjk(container)
    unmount()

    render(<DayMapExpanded dayIndex={2} points={[]} routeGeometry={null} onClose={() => {}} locale="ja" />)
    expect(screen.getByRole('heading', { name: '2 日目 · ルート' })).toBeTruthy()
  })

  it('en/ja：地图点位卡的三个动作', () => {
    const { container, unmount } = render(
      <DayPointCard item={null} title="Uji Bridge" lat={34.9} lng={135.8} onShowItem={() => {}} locale="en" />,
    )
    expect(screen.getByText('View in list')).toBeTruthy()
    expect(screen.getByText('Navigate')).toBeTruthy()
    expect(screen.getByText('Street View')).toBeTruthy()
    expectNoCjk(container)
    unmount()

    render(<DayPointCard item={null} title="Uji Bridge" lat={34.9} lng={135.8} onShowItem={() => {}} locale="ja" />)
    expect(screen.getByText('リストで見る')).toBeTruthy()
  })
})

describe('PlanPlanner（整页）', () => {
  it('en：标题行 aria-label、输入框、空对话提示都是英文', () => {
    const { container } = render(
      <PlanPlanner planId="plan-1" initialPlan={plan()} initialChat={[]} plans={[]} locale="en" />,
    )
    expect(screen.getByRole('button', { name: 'Open chat list' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Back to site' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Send' })).toBeTruthy()
    expectNoCjk(container)
  })

  it('ja：入力欄のプレースホルダー', () => {
    render(<PlanPlanner planId="plan-1" initialPlan={plan()} initialChat={[]} plans={[]} locale="ja" />)
    expect(screen.getByRole('button', { name: '送信' })).toBeTruthy()
  })

  it('缺省仍是中文（现有调用方不传 locale 时行为不变）', () => {
    render(<PlanPlanner planId="plan-1" initialPlan={plan()} initialChat={[]} plans={[]} />)
    expect(screen.getByRole('button', { name: '发送' })).toBeTruthy()
  })
})
