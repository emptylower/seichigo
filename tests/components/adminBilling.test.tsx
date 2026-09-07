import { describe, expect, it, vi, afterEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import AdminBillingClient from '@/app/(authed)/admin/billing/ui'

/** 最近 14 天 fixture：2026-08-25 ~ 2026-09-07（UTC 递推避免 8 月 38 日这类假日期），count 有高低差 */
const BY_DAY = Array.from({ length: 14 }, (_, i) => ({
  day: new Date(Date.UTC(2026, 7, 25) + i * 86400000).toISOString().slice(0, 10),
  count: (i * 3) % 7,
}))

const STATS = {
  total: 42,
  last24h: 5,
  last7d: 20,
  uniqueUsers: 9,
  anonymous: 12,
  byDay: BY_DAY,
}

function mockIntents(...responses: Array<{ body: unknown; status?: number }>) {
  const queue = [...responses]
  const fn = vi.fn().mockImplementation(() => {
    const next = queue.shift() ?? { body: { error: 'no more' }, status: 500 }
    return Promise.resolve(new Response(JSON.stringify(next.body), { status: next.status ?? 200 }))
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('AdminBillingClient（订阅意向）', () => {
  it('加载后请求 /api/admin/billing/intents 并展示开关“未开放”与各项统计', async () => {
    const fetchMock = mockIntents({ body: { ok: true, checkoutEnabled: false, stats: STATS } })
    render(<AdminBillingClient />)
    await screen.findByText(/未开放/)
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/billing/intents', expect.objectContaining({ method: 'GET' }))
    expect(screen.getByText('总点击')).toBeInTheDocument()
    expect(screen.getByText('42')).toBeInTheDocument()
    expect(screen.getByText('24 小时内')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
    expect(screen.getByText('7 天内')).toBeInTheDocument()
    expect(screen.getByText('20')).toBeInTheDocument()
    expect(screen.getByText('去重用户')).toBeInTheDocument()
    expect(screen.getByText('9')).toBeInTheDocument()
    expect(screen.getByText('未登录点击')).toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument()
  })

  it('开关打开时显示“已开放”', async () => {
    mockIntents({ body: { ok: true, checkoutEnabled: true, stats: STATS } })
    render(<AdminBillingClient />)
    await screen.findByText(/已开放/)
    expect(screen.queryByText(/未开放/)).not.toBeInTheDocument()
  })

  it('byDay 渲染最近 14 天柱状（每根带 日期：次数 提示）', async () => {
    mockIntents({ body: { ok: true, checkoutEnabled: false, stats: STATS } })
    render(<AdminBillingClient />)
    await screen.findByText(/未开放/)
    expect(screen.getByTitle('2026-08-25：0')).toBeInTheDocument()
    expect(screen.getByTitle('2026-09-03：6')).toBeInTheDocument()
    expect(screen.getByText('最近 14 天')).toBeInTheDocument()
  })

  it('接口失败显示错误与重试，重试成功后渲染统计', async () => {
    const fetchMock = mockIntents(
      { body: { error: 'Internal server error' }, status: 500 },
      { body: { ok: true, checkoutEnabled: false, stats: STATS } },
    )
    render(<AdminBillingClient />)
    const retry = await screen.findByRole('button', { name: '重试' })
    fireEvent.click(retry)
    await screen.findByText(/未开放/)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('页面不出现 credit / token / 成本 / 调用次数', async () => {
    mockIntents({ body: { ok: true, checkoutEnabled: true, stats: STATS } })
    const { container } = render(<AdminBillingClient />)
    await screen.findByText(/已开放/)
    expect(/credit|token|成本|调用次数/i.test(container.textContent ?? ''), container.textContent ?? '').toBe(false)
  })
})
