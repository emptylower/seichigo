import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import PricingTemplate from '@/components/pricing/PricingTemplate'

const CJK = /[一-龥ぁ-ヿ]/

/** 定价页的两个 CTA 挂载时都会问一次 GET /api/me/billing，默认按未登录渲染 */
function stubPlan(view: unknown | null) {
  const fn = vi
    .fn()
    .mockImplementation(() =>
      Promise.resolve(view ? new Response(JSON.stringify(view), { status: 200 }) : new Response('{}', { status: 401 })),
    )
  vi.stubGlobal('fetch', fn)
  return fn
}

beforeEach(() => {
  stubPlan(null)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('PricingTemplate', () => {
  it('zh：标题、三档卡片、功能表与页脚说明', async () => {
    render(<PricingTemplate locale="zh" />)
    expect(screen.getByRole('heading', { level: 1, name: '选择你的巡礼规划套餐' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: /免费/ })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: '开通标准版' })).toBeEnabled()
    expect(screen.getByText('真实路线 + 日本公交')).toBeInTheDocument()
    expect(screen.getByText('高级档全部功能即将推出。')).toBeInTheDocument()
  })

  it('en：全英文，无中日文残留', async () => {
    const { container } = render(<PricingTemplate locale="en" />)
    expect(screen.getByRole('heading', { level: 1, name: 'Pick the plan that fits your pilgrimage' })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Get Standard' })).toBeEnabled()
    expect(screen.getByText('Up to 3 days')).toBeInTheDocument()
    expect(screen.getAllByText('Coming soon').length).toBeGreaterThan(0)
    expect(CJK.test(container.textContent ?? ''), container.textContent ?? '').toBe(false)
  })

  it('ja：日文标题与功能表', async () => {
    render(<PricingTemplate locale="ja" />)
    expect(screen.getByRole('heading', { level: 1, name: '巡礼プランニングのプランをお選びください' })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'スタンダードを開始' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '近日公開' })).toBeDisabled()
    expect(screen.getByText('実際のルート＋日本の公共交通')).toBeInTheDocument()
    expect(screen.getByText('毎月のエージェント利用量')).toBeInTheDocument()
  })

  it('未登录：免费档仍是“当前可用”，标准档仍是购买按钮', async () => {
    render(<PricingTemplate locale="zh" />)
    expect(await screen.findByRole('button', { name: '开通标准版' })).toBeEnabled()
    expect(screen.getByRole('link', { name: '当前可用' })).toHaveAttribute('href', '/plan')
  })

  it('登录且免费档：免费卡片改成“当前套餐”', async () => {
    stubPlan({
      tier: 'free',
      hasSubscription: false,
      status: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
    })
    render(<PricingTemplate locale="zh" />)
    expect(await screen.findByRole('link', { name: '当前套餐' })).toHaveAttribute('href', '/plan')
    expect(screen.queryByRole('link', { name: '当前可用' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '开通标准版' })).toBeEnabled()
  })

  it('标准档：标准卡片变成当前套餐入口，免费卡片回到“当前可用”', async () => {
    stubPlan({
      tier: 'standard',
      hasSubscription: true,
      status: 'active',
      currentPeriodEnd: '2026-09-20T00:00:00.000Z',
      cancelAtPeriodEnd: false,
    })
    render(<PricingTemplate locale="zh" />)
    expect(await screen.findByRole('link', { name: '当前套餐 · 管理订阅' })).toHaveAttribute('href', '/me')
    expect(screen.queryByRole('button', { name: '开通标准版' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '当前可用' })).toBeInTheDocument()
  })

  it('三语都不出现 credit / token / 成本 / 调用次数', async () => {
    for (const locale of ['zh', 'en', 'ja'] as const) {
      const { container, unmount } = render(<PricingTemplate locale={locale} />)
      await screen.findByRole('heading', { level: 1 })
      const text = container.textContent ?? ''
      expect(/credit|token|成本|调用次数/i.test(text), `${locale}: ${text}`).toBe(false)
      unmount()
    }
  })

  it('功能表每行三档都有取值', async () => {
    const { container } = render(<PricingTemplate locale="en" />)
    await screen.findByRole('button', { name: 'Get Standard' })
    const rows = within(container).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(9)
    for (const row of rows) expect(within(row).getAllByRole('cell')).toHaveLength(4)
  })
})
