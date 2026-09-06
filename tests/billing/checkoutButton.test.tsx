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

function mockFetch(response: Response) {
  const fn = vi.fn().mockResolvedValue(response)
  vi.stubGlobal('fetch', fn)
  return fn
}

describe('CheckoutButton', () => {
  it('200：POST 结账接口后跳转 checkoutUrl', async () => {
    const assign = stubLocation()
    const fetchMock = mockFetch(
      new Response(JSON.stringify({ checkoutUrl: 'https://test-checkout.creem.io/abc' }), { status: 200 }),
    )
    render(<CheckoutButton locale="zh" />)
    fireEvent.click(screen.getByRole('button', { name: '开通标准版' }))
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://test-checkout.creem.io/abc'))
    expect(fetchMock).toHaveBeenCalledWith('/api/me/billing/checkout', expect.objectContaining({ method: 'POST' }))
  })

  it('200 但没有 checkoutUrl：落到不可用提示', async () => {
    const assign = stubLocation()
    mockFetch(new Response('{}', { status: 200 }))
    render(<CheckoutButton locale="zh" />)
    fireEvent.click(screen.getByRole('button', { name: '开通标准版' }))
    expect(await screen.findByText('支付暂不可用，请稍后再试')).toBeInTheDocument()
    expect(assign).not.toHaveBeenCalled()
  })

  it('401：跳登录并带 callbackUrl 回定价页', async () => {
    const assign = stubLocation()
    mockFetch(new Response('{}', { status: 401 }))
    render(<CheckoutButton locale="zh" />)
    fireEvent.click(screen.getByRole('button', { name: '开通标准版' }))
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/auth/signin?callbackUrl=%2Fpricing'))
  })

  it('401 + en：callbackUrl 带语言前缀', async () => {
    const assign = stubLocation()
    mockFetch(new Response('{}', { status: 401 }))
    render(<CheckoutButton locale="en" />)
    fireEvent.click(screen.getByRole('button', { name: 'Get Standard' }))
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/auth/signin?callbackUrl=%2Fen%2Fpricing'))
  })

  it('409：提示已是标准档并给出账户页链接', async () => {
    mockFetch(new Response(JSON.stringify({ code: 'already_subscribed' }), { status: 409 }))
    render(<CheckoutButton locale="zh" />)
    fireEvent.click(screen.getByRole('button', { name: '开通标准版' }))
    expect(await screen.findByText('你已经是标准档')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '查看订阅' })).toHaveAttribute('href', '/me')
  })

  it('503：提示支付暂不可用', async () => {
    mockFetch(new Response('{}', { status: 503 }))
    render(<CheckoutButton locale="zh" />)
    fireEvent.click(screen.getByRole('button', { name: '开通标准版' }))
    expect(await screen.findByText('支付暂不可用，请稍后再试')).toBeInTheDocument()
  })

  it('网络异常：同样落到不可用提示，不抛错', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    render(<CheckoutButton locale="ja" />)
    fireEvent.click(screen.getByRole('button', { name: 'スタンダードを開始' }))
    expect(await screen.findByText('現在お支払いをご利用いただけません。しばらくしてからお試しください')).toBeInTheDocument()
  })

  it('请求进行中按钮禁用并显示 loading 文案', async () => {
    let resolve: ((value: Response) => void) | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => new Promise<Response>((r) => (resolve = r))),
    )
    render(<CheckoutButton locale="zh" />)
    fireEvent.click(screen.getByRole('button', { name: '开通标准版' }))
    const button = await screen.findByRole('button', { name: '正在跳转…' })
    expect(button).toBeDisabled()
    resolve?.(new Response('{}', { status: 503 }))
    await waitFor(() => expect(screen.getByRole('button')).not.toBeDisabled())
  })

  it('callbackUrl 与 label 可覆盖（账户页复用时回 /me）', async () => {
    const assign = stubLocation()
    mockFetch(new Response('{}', { status: 401 }))
    render(<CheckoutButton locale="zh" callbackUrl="/me" label="升级到标准版" />)
    fireEvent.click(screen.getByRole('button', { name: '升级到标准版' }))
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/auth/signin?callbackUrl=%2Fme'))
  })
})
