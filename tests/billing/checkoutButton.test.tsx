import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CheckoutButton } from '@/components/billing/CheckoutButton'

const originalLocation = window.location

function stubLocation(): ReturnType<typeof vi.fn> {
  const assign = vi.fn()
  delete (window as unknown as { location?: unknown }).location
  ;(window as unknown as { location: unknown }).location = {
    href: 'http://localhost/pricing',
    pathname: '/pricing',
    search: '',
    assign,
  }
  return assign
}

beforeEach(() => {
  stubLocation()
})

afterEach(() => {
  vi.unstubAllGlobals()
  ;(window as unknown as { location: unknown }).location = originalLocation
})

/** 未登录：挂载时的 GET /api/me/billing 返回 401 */
const anonPlan = () => new Response('{}', { status: 401 })

/**
 * 每次调用都要新 Response：body 只能读一次。
 * POST 走结账接口，GET 走档位查询（默认未登录）。
 */
function mockFetch(checkout: () => Response, plan: () => Response = anonPlan) {
  const fn = vi.fn().mockImplementation((_url: string, init?: RequestInit) =>
    Promise.resolve(init?.method === 'POST' ? checkout() : plan()),
  )
  vi.stubGlobal('fetch', fn)
  return fn
}

function planResponse(view: Record<string, unknown>) {
  return () => new Response(JSON.stringify(view), { status: 200 })
}

/** 等档位查询结束，避免点到还处于 loading 的按钮 */
function findCta(name: string) {
  return screen.findByRole('button', { name })
}

describe('CheckoutButton', () => {
  it('200：POST 结账接口后跳转 checkoutUrl', async () => {
    const assign = stubLocation()
    const fetchMock = mockFetch(
      () => new Response(JSON.stringify({ checkoutUrl: 'https://test-checkout.creem.io/abc' }), { status: 200 }),
    )
    render(<CheckoutButton locale="zh" />)
    fireEvent.click(await findCta('开通标准版'))
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://test-checkout.creem.io/abc'))
    expect(fetchMock).toHaveBeenCalledWith('/api/me/billing/checkout', expect.objectContaining({ method: 'POST' }))
  })

  it('200 但没有 checkoutUrl：落到不可用提示', async () => {
    const assign = stubLocation()
    mockFetch(() => new Response('{}', { status: 200 }))
    render(<CheckoutButton locale="zh" />)
    fireEvent.click(await findCta('开通标准版'))
    expect(await screen.findByText('支付暂不可用，请稍后再试')).toBeInTheDocument()
    expect(assign).not.toHaveBeenCalled()
  })

  it('F7：checkoutUrl 非 https:// → 按“支付暂不可用”处理，不跳转', async () => {
    const assign = stubLocation()
    mockFetch(() => new Response(JSON.stringify({ checkoutUrl: 'http://evil.example.com/checkout' }), { status: 200 }))
    render(<CheckoutButton locale="zh" />)
    fireEvent.click(await findCta('开通标准版'))
    expect(await screen.findByText('支付暂不可用，请稍后再试')).toBeInTheDocument()
    expect(assign).not.toHaveBeenCalled()
  })

  it('F7：checkoutUrl 为 javascript: 伪协议 → 同样拒绝', async () => {
    const assign = stubLocation()
    mockFetch(() => new Response(JSON.stringify({ checkoutUrl: 'javascript:alert(1)' }), { status: 200 }))
    render(<CheckoutButton locale="zh" />)
    fireEvent.click(await findCta('开通标准版'))
    expect(await screen.findByText('支付暂不可用，请稍后再试')).toBeInTheDocument()
    expect(assign).not.toHaveBeenCalled()
  })

  it('401：跳登录并带 callbackUrl 回定价页', async () => {
    const assign = stubLocation()
    mockFetch(() => new Response('{}', { status: 401 }))
    render(<CheckoutButton locale="zh" />)
    fireEvent.click(await findCta('开通标准版'))
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/auth/signin?callbackUrl=%2Fpricing'))
  })

  it('401 + en：callbackUrl 带语言前缀', async () => {
    const assign = stubLocation()
    mockFetch(() => new Response('{}', { status: 401 }))
    render(<CheckoutButton locale="en" />)
    fireEvent.click(await findCta('Get Standard'))
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/auth/signin?callbackUrl=%2Fen%2Fpricing'))
  })

  it('409：提示已是标准档并给出账户页链接', async () => {
    mockFetch(() => new Response(JSON.stringify({ code: 'already_subscribed' }), { status: 409 }))
    render(<CheckoutButton locale="zh" />)
    fireEvent.click(await findCta('开通标准版'))
    expect(await screen.findByText('你已经是标准档')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '查看订阅' })).toHaveAttribute('href', '/me')
  })

  it('503：提示支付暂不可用', async () => {
    mockFetch(() => new Response('{}', { status: 503 }))
    render(<CheckoutButton locale="zh" />)
    fireEvent.click(await findCta('开通标准版'))
    expect(await screen.findByText('支付暂不可用，请稍后再试')).toBeInTheDocument()
  })

  it('网络异常：同样落到不可用提示，不抛错', async () => {
    mockFetch(() => {
      throw new Error('offline')
    })
    render(<CheckoutButton locale="ja" />)
    fireEvent.click(await findCta('スタンダードを開始'))
    expect(await screen.findByText('現在お支払いをご利用いただけません。しばらくしてからお試しください')).toBeInTheDocument()
  })

  it('请求进行中按钮禁用并显示 loading 文案', async () => {
    let resolve: ((value: Response) => void) | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((_url: string, init?: RequestInit) =>
        init?.method === 'POST' ? new Promise<Response>((r) => (resolve = r)) : Promise.resolve(anonPlan()),
      ),
    )
    render(<CheckoutButton locale="zh" />)
    fireEvent.click(await screen.findByRole('button', { name: '开通标准版' }))
    const button = await screen.findByRole('button', { name: '正在跳转…' })
    expect(button).toBeDisabled()
    resolve?.(new Response('{}', { status: 503 }))
    await waitFor(() => expect(screen.getByRole('button')).not.toBeDisabled())
  })

  it('callbackUrl 与 label 可覆盖（账户页复用时回 /me）', async () => {
    const assign = stubLocation()
    mockFetch(() => new Response('{}', { status: 401 }))
    render(<CheckoutButton locale="zh" callbackUrl="/me" label="升级到标准版" />)
    fireEvent.click(await findCta('升级到标准版'))
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/auth/signin?callbackUrl=%2Fme'))
  })
})

describe('CheckoutButton 档位状态', () => {
  it('档位查询未回来前按钮禁用并显示 loading，不闪“开通标准版”', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Promise<Response>(() => {})))
    render(<CheckoutButton locale="zh" />)
    const button = screen.getByRole('button', { name: '正在跳转…' })
    expect(button).toBeDisabled()
    expect(screen.queryByRole('button', { name: '开通标准版' })).not.toBeInTheDocument()
  })

  it('standard：换成“当前套餐 · 管理订阅”链接，指向账户页，且不再有购买按钮', async () => {
    mockFetch(
      () => new Response('{}', { status: 200 }),
      planResponse({
        tier: 'standard',
        hasSubscription: true,
        status: 'active',
        currentPeriodEnd: '2026-09-20T00:00:00.000Z',
        cancelAtPeriodEnd: false,
      }),
    )
    render(<CheckoutButton locale="zh" />)
    const link = await screen.findByRole('link', { name: '当前套餐 · 管理订阅' })
    expect(link).toHaveAttribute('href', '/me')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByText(/到期/)).not.toBeInTheDocument()
  })

  it('standard + cancelAtPeriodEnd：补一行“将于 {date} 到期”', async () => {
    mockFetch(
      () => new Response('{}', { status: 200 }),
      planResponse({
        tier: 'standard',
        hasSubscription: true,
        status: 'active',
        currentPeriodEnd: '2026-09-20T00:00:00.000Z',
        cancelAtPeriodEnd: true,
      }),
    )
    render(<CheckoutButton locale="zh" />)
    expect(await screen.findByRole('link', { name: '当前套餐 · 管理订阅' })).toBeInTheDocument()
    expect(screen.getByText(/^将于 9月(19|20)日 到期$/)).toBeInTheDocument()
  })

  it('standard + en：文案与账户页链接三语可用', async () => {
    mockFetch(
      () => new Response('{}', { status: 200 }),
      planResponse({
        tier: 'standard',
        hasSubscription: true,
        status: 'active',
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
      }),
    )
    render(<CheckoutButton locale="en" />)
    const link = await screen.findByRole('link', { name: 'Current plan · Manage subscription' })
    expect(link).toHaveAttribute('href', '/me')
  })

  it('pro：只显示“当前套餐”，不可点', async () => {
    mockFetch(
      () => new Response('{}', { status: 200 }),
      planResponse({
        tier: 'pro',
        hasSubscription: true,
        status: 'active',
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
      }),
    )
    render(<CheckoutButton locale="zh" />)
    expect(await screen.findByText('当前套餐')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('free：仍然是可点的开通按钮', async () => {
    mockFetch(
      () => new Response('{}', { status: 200 }),
      planResponse({
        tier: 'free',
        hasSubscription: false,
        status: null,
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
      }),
    )
    render(<CheckoutButton locale="zh" />)
    expect(await findCta('开通标准版')).toBeEnabled()
  })

  it('401（未登录）：仍然是可点的开通按钮', async () => {
    mockFetch(() => new Response('{}', { status: 200 }))
    render(<CheckoutButton locale="zh" />)
    expect(await findCta('开通标准版')).toBeEnabled()
  })

  it('档位查询失败：按未知处理，照常给开通按钮', async () => {
    mockFetch(
      () => new Response('{}', { status: 200 }),
      () => new Response('boom', { status: 500 }),
    )
    render(<CheckoutButton locale="zh" />)
    expect(await findCta('开通标准版')).toBeEnabled()
  })

  it('档位查询抛异常：同样落到开通按钮', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((_url: string, init?: RequestInit) =>
        init?.method === 'POST' ? Promise.resolve(new Response('{}', { status: 200 })) : Promise.reject(new Error('offline')),
      ),
    )
    render(<CheckoutButton locale="zh" />)
    expect(await findCta('开通标准版')).toBeEnabled()
  })

  it('skipPlanCheck：不发档位查询请求，直接给开通按钮', async () => {
    const fetchMock = mockFetch(() => new Response('{}', { status: 200 }))
    render(<CheckoutButton locale="zh" skipPlanCheck />)
    expect(await findCta('开通标准版')).toBeEnabled()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
