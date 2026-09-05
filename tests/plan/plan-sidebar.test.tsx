import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { renderToString } from 'react-dom/server'

const pushMock = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}))

// PlanSidebar 站点区用 next/link（app router 上下文在 jsdom 不存在），替换为普通 a
vi.mock('next/link', () => ({
  default: (props: { href: string; 'aria-label'?: string; children: React.ReactNode; className?: string }) => (
    <a href={props.href} aria-label={props['aria-label']} className={props.className}>
      {props.children}
    </a>
  ),
}))

import { PLANS_CHANGED_EVENT, PlanSidebar, type PlanSidebarPlan } from '@/app/(authed)/plan/[id]/components/PlanSidebar'

function plan(partial: Partial<PlanSidebarPlan> & { id: string }): PlanSidebarPlan {
  return { title: partial.id, updatedAt: new Date().toISOString(), ...partial }
}

function daysAgoIso(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString()
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
  pushMock.mockClear()
})

describe('PlanSidebar 会话列表', () => {
  it('渲染 3 个计划：当前项高亮，其余不高亮', () => {
    const plans = [
      plan({ id: 'p-new', title: '最新对话', updatedAt: daysAgoIso(0) }),
      plan({ id: 'p-mid', title: '京都三日', updatedAt: daysAgoIso(2) }),
      plan({ id: 'p-old', title: '老计划', updatedAt: daysAgoIso(10) }),
    ]
    render(<PlanSidebar plans={plans} currentPlanId="p-mid" mobileOpen={false} onCloseMobile={() => {}} />)

    expect(screen.getByText('最新对话')).toBeTruthy()
    expect(screen.getByText('京都三日')).toBeTruthy()
    expect(screen.getByText('老计划')).toBeTruthy()
    const current = screen.getByText('京都三日').closest('button')!
    expect(current.getAttribute('aria-current')).toBe('page')
    const notCurrent = screen.getByText('最新对话').closest('button')!
    expect(notCurrent.getAttribute('aria-current')).not.toBe('page')
  })

  it('空标题或默认标题显示为“新对话”，时间显示“今天/昨天”', () => {
    const plans = [
      plan({ id: 'p1', title: '', updatedAt: daysAgoIso(0) }),
      plan({ id: 'p2', title: '未命名巡礼计划', updatedAt: daysAgoIso(1) }),
    ]
    render(<PlanSidebar plans={plans} currentPlanId="p1" mobileOpen={false} onCloseMobile={() => {}} />)
    expect(screen.getAllByText('新对话')).toHaveLength(2)
    expect(screen.getByText('今天')).toBeTruthy()
    expect(screen.getByText('昨天')).toBeTruthy()
  })

  it('SSR 首帧不含「今天/昨天/M月D日」本地时间文本（水合一致）', () => {
    const plans = [
      plan({ id: 'p1', title: '最新对话', updatedAt: daysAgoIso(0) }),
      plan({ id: 'p2', title: '京都三日', updatedAt: daysAgoIso(2) }),
    ]
    const html = renderToString(<PlanSidebar plans={plans} currentPlanId="p1" mobileOpen={false} onCloseMobile={() => {}} />)
    expect(html).toContain('最新对话')
    expect(html).not.toContain('今天')
    expect(html).not.toContain('昨天')
    expect(html).not.toMatch(/\d+月\d+日/)
  })

  it('点击“新建对话”调用 POST /api/me/plans 并跳转到新对话', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ plan: { id: 'p-created' } }), {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
          }),
      ),
    )
    render(<PlanSidebar plans={[]} currentPlanId="p-x" mobileOpen={false} onCloseMobile={() => {}} />)

    fireEvent.click(screen.getByRole('button', { name: /新建对话/ }))
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/plan/p-created'))
    const calls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls
    expect(
      calls.some(([url, init]) => String(url) === '/api/me/plans' && (init as RequestInit | undefined)?.method === 'POST'),
    ).toBe(true)
  })

  it('顶部站点区：Logo 链接回首页，含 地图/文章/城市/我的 紧凑导航，再下面是“新建对话”', () => {
    render(<PlanSidebar plans={[]} currentPlanId="p1" mobileOpen={false} onCloseMobile={() => {}} />)

    // Logo/站点名回首页
    expect(screen.getByText('SeichiGo').closest('a')?.getAttribute('href')).toBe('/')
    // 紧凑导航四项
    expect(screen.getByRole('link', { name: /地图/ }).getAttribute('href')).toBe('/map')
    expect(screen.getByRole('link', { name: /文章/ }).getAttribute('href')).toBe('/')
    expect(screen.getByRole('link', { name: /城市/ }).getAttribute('href')).toBe('/city')
    expect(screen.getByRole('link', { name: /我的/ }).getAttribute('href')).toBe('/me')
    // 新建对话入口仍在
    expect(screen.getByRole('button', { name: /新建对话/ })).toBeTruthy()
  })

  it('移动端抽屉同样包含站点导航', () => {
    render(<PlanSidebar plans={[]} currentPlanId="p1" mobileOpen onCloseMobile={() => {}} />)
    // 桌面侧栏 + 移动抽屉各渲染一份站点导航
    expect(screen.getAllByRole('link', { name: /地图/ }).length).toBeGreaterThanOrEqual(2)
    expect(screen.getAllByRole('link', { name: /城市/ }).length).toBeGreaterThanOrEqual(2)
  })

  it('收到 plans 变更事件后重新 GET /api/me/plans 拉取最新列表', async () => {
    const fetchMock = vi.fn(
      async (_input?: unknown) =>
        new Response(JSON.stringify({ plans: [plan({ id: 'p-fresh', title: '生成的新标题' })] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    )
    vi.stubGlobal('fetch', fetchMock)

    render(
      <PlanSidebar
        plans={[plan({ id: 'p1', title: '', updatedAt: daysAgoIso(0) })]}
        currentPlanId="p1"
        mobileOpen={false}
        onCloseMobile={() => {}}
      />,
    )
    expect(screen.queryByText('生成的新标题')).toBeNull()

    window.dispatchEvent(new Event(PLANS_CHANGED_EVENT))
    await waitFor(() => expect(screen.getByText('生成的新标题')).toBeTruthy())
    expect(fetchMock.mock.calls.some(([url]) => String(url) === '/api/me/plans')).toBe(true)
  })
})
