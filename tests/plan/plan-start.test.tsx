import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const pushMock = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}))

/** 登录弹窗自身有独立用例；这里只关心「打开了」以及登录成功后的回调链路 */
vi.mock('@/components/auth/LoginModal', () => ({
  default: (props: { open: boolean; onClose: () => void; onSuccess: () => void }) =>
    props.open ? (
      <div data-testid="login-modal">
        <button type="button" onClick={props.onSuccess}>
          模拟登录成功
        </button>
      </div>
    ) : null,
}))

import PlanStartClient from '@/app/(authed)/plan/start/ui'
import { parseStartLocale } from '@/app/(authed)/plan/start/locale'
import { PENDING_DRAFT_KEY } from '@/app/(authed)/plan/[id]/hooks/usePendingDraft'

const DRAFT = '圣诞周去东京 8 天，想巡礼《天气之子》和《你的名字》，顺便逛秋叶原'

describe('规划师起始页（游客可进，发送时才登录）', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    pushMock.mockReset()
    fetchMock.mockReset()
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ plan: { id: 'plan-new' } }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    ;(globalThis as { fetch: unknown }).fetch = fetchMock
    window.sessionStorage.clear()
  })

  it('预填 draft，并给出规划师欢迎气泡与示例 chip', () => {
    render(<PlanStartClient initialDraft={DRAFT} signedIn={false} />)

    expect(screen.getByRole('textbox')).toHaveValue(DRAFT)
    expect(screen.getByRole('link', { name: '回到网站' })).toHaveAttribute('href', '/')
    expect(screen.getAllByRole('button', { name: /巡礼/ }).length).toBeGreaterThanOrEqual(3)
  })

  it('低-6：locale=ja 时整页取日文文案（首页跳过来时带 ?locale=）', () => {
    render(<PlanStartClient initialDraft="" signedIn locale="ja" />)

    expect(screen.getByRole('heading', { name: 'プランを作る' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'サイトに戻る' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '送信' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '週末 2 日間、鎌倉で『SLAM DUNK』を巡礼' })).toBeInTheDocument()
  })

  it('游客发送 → 弹登录；不建计划', () => {
    render(<PlanStartClient initialDraft={DRAFT} signedIn={false} />)

    fireEvent.click(screen.getByRole('button', { name: '发送' }))

    expect(screen.getByTestId('login-modal')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('登录成功后不刷新页面，直接建计划、写 pending draft 并进入计划页', async () => {
    render(<PlanStartClient initialDraft={DRAFT} signedIn={false} />)

    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    fireEvent.click(screen.getByRole('button', { name: '模拟登录成功' }))

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/plan/plan-new'))
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/me/plans')
    expect(JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body))).toEqual({ title: DRAFT.slice(0, 30) })

    const pending = JSON.parse(window.sessionStorage.getItem(PENDING_DRAFT_KEY) ?? 'null')
    expect(pending.text).toBe(DRAFT)
    expect(typeof pending.createdAt).toBe('number')
  })

  it('中-1：登录成功后 signedIn 变本地 state——重试时不再弹登录', async () => {
    // 第一次创建失败（busy 会放开），登录态本身已经拿到了
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: '创建失败，请稍后再试' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    render(<PlanStartClient initialDraft={DRAFT} signedIn={false} />)

    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    fireEvent.click(screen.getByRole('button', { name: '模拟登录成功' }))
    expect(await screen.findByText('创建失败，请稍后再试')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '发送' }))

    expect(screen.queryByTestId('login-modal')).toBeNull()
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/plan/plan-new'))
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('中-8：成功建计划后不放开 busy——跳转期间连点只建一个计划', async () => {
    render(<PlanStartClient initialDraft={DRAFT} signedIn />)

    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/plan/plan-new'))

    fireEvent.click(screen.getByRole('button', { name: '发送' }))

    expect(screen.getByRole('button', { name: '发送' })).toBeDisabled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('中-2：输入法组词中的回车不发送', () => {
    render(<PlanStartClient initialDraft={DRAFT} signedIn />)
    const textarea = screen.getByRole('textbox')

    fireEvent.keyDown(textarea, { key: 'Enter', isComposing: true })
    expect(fetchMock).not.toHaveBeenCalled()

    fireEvent.keyDown(textarea, { key: 'Enter' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('已登录直接建计划，不弹窗', async () => {
    render(<PlanStartClient initialDraft={DRAFT} signedIn />)

    fireEvent.click(screen.getByRole('button', { name: '发送' }))

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/plan/plan-new'))
    expect(screen.queryByTestId('login-modal')).toBeNull()
  })

  it('429（每日上限）显示提示且不跳转', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: '今日创建计划次数已达上限，明天再来吧' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    render(<PlanStartClient initialDraft={DRAFT} signedIn />)

    fireEvent.click(screen.getByRole('button', { name: '发送' }))

    expect(await screen.findByText('今日创建计划次数已达上限，明天再来吧')).toBeInTheDocument()
    expect(pushMock).not.toHaveBeenCalled()
  })

  it('空输入不发送', () => {
    render(<PlanStartClient initialDraft="" signedIn />)

    fireEvent.click(screen.getByRole('button', { name: '发送' }))

    expect(fetchMock).not.toHaveBeenCalled()
    expect(pushMock).not.toHaveBeenCalled()
  })
})

describe('syncLocaleCookie：显式 ?locale= 时把语言落到 NEXT_LOCALE cookie', () => {
  beforeEach(() => {
    // jsdom 的 document.cookie 不能整体清空，逐个过期即可
    for (const pair of document.cookie.split(';')) {
      const name = pair.split('=')[0]?.trim()
      if (name) document.cookie = `${name}=; path=/; max-age=0`
    }
  })

  it('syncLocaleCookie 为 true 时写 cookie', () => {
    render(<PlanStartClient initialDraft="" signedIn locale="ja" syncLocaleCookie />)
    expect(document.cookie).toContain('NEXT_LOCALE=ja')
  })

  it('不传时不写 cookie（站点解析出来的语言不该被起始页固化）', () => {
    render(<PlanStartClient initialDraft="" signedIn locale="ja" />)
    expect(document.cookie).not.toContain('NEXT_LOCALE')
  })
})

describe('parseStartLocale（?locale= 只认三种语言）', () => {
  it('认识 en/ja，其余返回 null 由页面回落 getLocale', () => {
    expect(parseStartLocale('en')).toBe('en')
    expect(parseStartLocale('ja')).toBe('ja')
    expect(parseStartLocale(['ja', 'en'])).toBe('ja')
    expect(parseStartLocale(undefined)).toBeNull()
    expect(parseStartLocale('de')).toBeNull()
    expect(parseStartLocale('')).toBeNull()
  })
})
