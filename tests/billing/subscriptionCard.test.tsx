import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SubscriptionCard } from '@/components/billing/SubscriptionCard'
import { USAGE_CHANGED_EVENT } from '@/hooks/useUsage'

const originalLocation = window.location

function stubLocation(): ReturnType<typeof vi.fn> {
  const assign = vi.fn()
  delete (window as unknown as { location?: unknown }).location
  ;(window as unknown as { location: unknown }).location = {
    href: 'http://localhost/me',
    pathname: '/me',
    search: '',
    assign,
  }
  return assign
}

const freeView = { tier: 'free', hasSubscription: false, status: null, currentPeriodEnd: null, cancelAtPeriodEnd: false }
const standardView = {
  tier: 'standard',
  hasSubscription: true,
  status: 'active',
  currentPeriodEnd: '2026-09-20T00:00:00.000Z',
  cancelAtPeriodEnd: false,
}

/** 每次调用都要新 Response：body 只能读一次，复用同一个对象会让第二次 res.json() 抛错 */
function json(body: unknown, status = 200) {
  return () => new Response(JSON.stringify(body), { status })
}

beforeEach(() => {
  stubLocation()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  ;(window as unknown as { location: unknown }).location = originalLocation
})

describe('SubscriptionCard', () => {
  it('免费档：显示当前档位与升级按钮', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(json(freeView)))
    render(<SubscriptionCard locale="zh" />)
    expect(await screen.findByText('当前：免费')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '升级到标准版' })).toBeInTheDocument()
  })

  it('标准档：显示下次续费日期与管理订阅按钮', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(json(standardView)))
    render(<SubscriptionCard locale="zh" />)
    expect(await screen.findByText('当前：标准')).toBeInTheDocument()
    expect(screen.getByText(/^下次续费 9月(19|20)日$/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '管理订阅' })).toBeInTheDocument()
  })

  it('已预约取消：显示到期日而不是续费日', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(json({ ...standardView, cancelAtPeriodEnd: true })))
    render(<SubscriptionCard locale="zh" />)
    expect(await screen.findByText(/^将于 9月(19|20)日 到期$/)).toBeInTheDocument()
    expect(screen.queryByText(/下次续费/)).not.toBeInTheDocument()
  })

  it('管理订阅：POST 门户接口后跳转 portalUrl', async () => {
    const assign = stubLocation()
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(json(standardView))
      .mockImplementationOnce(json({ portalUrl: 'https://portal.creem.io/x' }))
    vi.stubGlobal('fetch', fetchMock)
    render(<SubscriptionCard locale="zh" />)
    fireEvent.click(await screen.findByRole('button', { name: '管理订阅' }))
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://portal.creem.io/x'))
    expect(fetchMock).toHaveBeenLastCalledWith('/api/me/billing/portal', expect.objectContaining({ method: 'POST' }))
  })

  it('管理订阅失败：给出可重试提示', async () => {
    const fetchMock = vi.fn().mockImplementationOnce(json(standardView)).mockImplementationOnce(json({}, 500))
    vi.stubGlobal('fetch', fetchMock)
    render(<SubscriptionCard locale="zh" />)
    fireEvent.click(await screen.findByRole('button', { name: '管理订阅' }))
    expect(await screen.findByText('暂时无法打开订阅管理页，请稍后再试')).toBeInTheDocument()
  })

  it('接口不可用时整块隐藏', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(json({}, 404)))
    const { container } = render(<SubscriptionCard locale="zh" />)
    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })

  it('billing=success：显示开通中，轮询到标准档后显示开通成功并广播用量变化', async () => {
    vi.useFakeTimers()
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(json(freeView))
      .mockImplementationOnce(json(freeView))
      .mockImplementation(json(standardView))
    vi.stubGlobal('fetch', fetchMock)
    const onUsageChanged = vi.fn()
    window.addEventListener(USAGE_CHANGED_EVENT, onUsageChanged)

    render(<SubscriptionCard locale="zh" pendingActivation />)
    await act(async () => {})
    expect(screen.getByText('正在开通，通常几秒内生效')).toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })
    expect(screen.getByText('正在开通，通常几秒内生效')).toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })
    expect(screen.getByText('开通成功')).toBeInTheDocument()
    expect(onUsageChanged).toHaveBeenCalled()

    const callsAfterActivation = fetchMock.mock.calls.length
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30000)
    })
    expect(fetchMock.mock.calls.length).toBe(callsAfterActivation)
    window.removeEventListener(USAGE_CHANGED_EVENT, onUsageChanged)
  })

  it('billing=success 但一直没生效：轮询最多 30 秒后停下', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn().mockImplementation(json(freeView))
    vi.stubGlobal('fetch', fetchMock)
    render(<SubscriptionCard locale="zh" pendingActivation />)
    await act(async () => {})
    // 逐个 tick 推进（一次推 60 秒只会跑掉当时已排好的那一个 timer）
    for (let i = 0; i < 15; i += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000)
      })
    }
    // 首次加载 1 次 + 最多 10 次轮询后停下
    expect(fetchMock.mock.calls.length).toBe(11)
    expect(screen.getByText('正在开通，通常几秒内生效')).toBeInTheDocument()
  })

  it('en / ja：文案本地化', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(json(standardView)))
    const en = render(<SubscriptionCard locale="en" />)
    expect(await screen.findByText('Current plan: Standard')).toBeInTheDocument()
    expect(screen.getByText(/^Renews on Sep (19|20)$/)).toBeInTheDocument()
    expect(/[一-龥ぁ-ヿ]/.test(en.container.textContent ?? '')).toBe(false)
    en.unmount()
    render(<SubscriptionCard locale="ja" />)
    expect(await screen.findByText('現在のプラン：スタンダード')).toBeInTheDocument()
    expect(screen.getByText(/^次回更新 9月(19|20)日$/)).toBeInTheDocument()
  })
})
