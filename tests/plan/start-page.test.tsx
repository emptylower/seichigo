import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

const getSessionMock = vi.fn()
const redirectMock = vi.fn()

vi.mock('@/lib/auth/session', () => ({
  getServerAuthSession: () => getSessionMock(),
}))

// Next 的 redirect() 通过抛错中止渲染；mock 保持同语义，catch 后断言目标
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    redirectMock(url)
    throw new Error(`NEXT_REDIRECT:${url}`)
  },
}))

/** 客户端组件有独立用例（plan-start.test.tsx）；这里只看服务器传了什么 */
vi.mock('@/app/(plan-start)/plan/start/ui', () => ({
  default: (props: {
    initialDraft: string
    signedIn: boolean
    locale: string
    syncLocaleCookie?: boolean
  }) => (
    <div data-testid="plan-start-client" data-locale={props.locale} data-sync-cookie={String(props.syncLocaleCookie)}>
      <span data-testid="initial-draft">{props.initialDraft}</span>
      <span data-testid="signed-in">{String(props.signedIn)}</span>
    </div>
  ),
}))

import ZhStartPage from '@/app/(plan-start)/plan/start/page'
import EnStartPage from '@/app/en/plan/start/page'
import JaStartPage from '@/app/ja/plan/start/page'
import PlanStartPageContent from '@/components/plan/PlanStartPageContent'

function sp(params: Record<string, string | string[]>): Promise<Record<string, string | string[]>> {
  return Promise.resolve(params)
}

/** 页面是 async 服务器组件：直接调用，返回交给 PlanStartPageContent 的元素（redirect 场景会抛错） */
async function callPage(
  page: (props: { searchParams: Promise<Record<string, string | string[]>> }) => Promise<React.ReactElement>,
  params: Record<string, string | string[]>,
): Promise<React.ReactElement<{ locale: string; draft: string }>> {
  return (await page({ searchParams: sp(params) })) as React.ReactElement<{ locale: string; draft: string }>
}

describe('起始页服务器路由（§3.3 URL 协议表）', () => {
  beforeEach(() => {
    getSessionMock.mockReset().mockResolvedValue(null)
    redirectMock.mockReset()
  })

  it('/plan/start 无 locale：中文 200（语言绑定 zh，不受 Cookie/Accept-Language 影响）', async () => {
    const element = await callPage(ZhStartPage, {})

    expect(redirectMock).not.toHaveBeenCalled()
    expect(element.type).toBe(PlanStartPageContent)
    expect(element.props.locale).toBe('zh')
    expect(element.props.draft).toBe('')
  })

  it('root locale 缺失/非法/空值/zh：都不重定向，留在中文', async () => {
    for (const locale of [undefined, 'xx', '', 'zh', ['zh', 'en']]) {
      redirectMock.mockClear()
      const params: Record<string, string | string[]> = {}
      if (locale !== undefined) params.locale = locale
      const element = await callPage(ZhStartPage, params)
      expect(redirectMock).not.toHaveBeenCalled()
      expect(element.props.locale).toBe('zh')
    }
  })

  it('/plan/start?draft=X&locale=en → 307 /en/plan/start?draft=X，且在读会话之前', async () => {
    await expect(callPage(ZhStartPage, { draft: 'X', locale: 'en' })).rejects.toThrow('NEXT_REDIRECT')
    expect(redirectMock).toHaveBeenCalledWith('/en/plan/start?draft=X')
    expect(getSessionMock).not.toHaveBeenCalled()
  })

  it('/plan/start?draft=X&locale=ja → 307 /ja/plan/start?draft=X', async () => {
    await expect(callPage(ZhStartPage, { draft: 'X', locale: 'ja' })).rejects.toThrow('NEXT_REDIRECT')
    expect(redirectMock).toHaveBeenCalledWith('/ja/plan/start?draft=X')
  })

  it('兼容重定向保留第一项 draft 的解码原值（重新编码一次，不 trim 不截断）', async () => {
    const draft = '  東京 5 日間 & 京都  '
    await expect(callPage(ZhStartPage, { draft, locale: 'ja' })).rejects.toThrow('NEXT_REDIRECT')
    expect(redirectMock).toHaveBeenCalledWith(`/ja/plan/start?draft=${encodeURIComponent(draft)}`)
  })

  it('重定向不截断超长草稿（500 截断只发生在传给客户端时）', async () => {
    const draft = 'あ'.repeat(600)
    await expect(callPage(ZhStartPage, { draft, locale: 'en' })).rejects.toThrow('NEXT_REDIRECT')
    expect(redirectMock).toHaveBeenCalledWith(`/en/plan/start?draft=${encodeURIComponent(draft)}`)
  })

  it('重复参数 locale/draft 分别取第一项', async () => {
    await expect(callPage(ZhStartPage, { draft: ['a', 'b'], locale: ['ja', 'en'] })).rejects.toThrow('NEXT_REDIRECT')
    expect(redirectMock).toHaveBeenCalledWith('/ja/plan/start?draft=a')
  })

  it('locale=en 且 draft 为空：307 到干净目标路径（不带空 draft）', async () => {
    await expect(callPage(ZhStartPage, { locale: 'en' })).rejects.toThrow('NEXT_REDIRECT')
    expect(redirectMock).toHaveBeenCalledWith('/en/plan/start')
  })

  it('/en/plan/start：英文 200，路径上的 ?locale= 不覆盖路径', async () => {
    const element = await callPage(EnStartPage, { draft: 'X', locale: 'ja' })

    expect(redirectMock).not.toHaveBeenCalled()
    expect(element.type).toBe(PlanStartPageContent)
    expect(element.props.locale).toBe('en')
    expect(element.props.draft).toBe('X')
  })

  it('/ja/plan/start：日文 200，路径上的 ?locale= 不覆盖路径', async () => {
    const element = await callPage(JaStartPage, { draft: 'X', locale: 'en' })

    expect(redirectMock).not.toHaveBeenCalled()
    expect(element.props.locale).toBe('ja')
  })

  it('en/ja 入口的重复 draft 也取第一项', async () => {
    const element = await callPage(EnStartPage, { draft: ['a', 'b'] })
    expect(element.props.draft).toBe('a')
  })
})

describe('PlanStartPageContent（共享服务器内容：会话、密码检查、500 截断）', () => {
  beforeEach(() => {
    getSessionMock.mockReset().mockResolvedValue(null)
    redirectMock.mockReset()
  })

  it('游客可进：渲染客户端，语言来自路径绑定且同步 cookie，signedIn=false', async () => {
    render(await PlanStartPageContent({ locale: 'zh', draft: '' }))

    expect(redirectMock).not.toHaveBeenCalled()
    expect(screen.getByTestId('plan-start-client')).toHaveAttribute('data-locale', 'zh')
    expect(screen.getByTestId('plan-start-client')).toHaveAttribute('data-sync-cookie', 'true')
    expect(screen.getByTestId('signed-in')).toHaveTextContent('false')
  })

  it('draft 传客户端前截断到 500', async () => {
    render(await PlanStartPageContent({ locale: 'ja', draft: 'あ'.repeat(600) }))
    expect(screen.getByTestId('initial-draft')).toHaveTextContent('あ'.repeat(500))
  })

  it('登录态如实传递 signedIn', async () => {
    getSessionMock.mockResolvedValue({ user: { id: 'u1' } })
    render(await PlanStartPageContent({ locale: 'en', draft: 'x' }))
    expect(screen.getByTestId('signed-in')).toHaveTextContent('true')
    expect(screen.getByTestId('plan-start-client')).toHaveAttribute('data-locale', 'en')
  })

  it('needsPasswordSetup → /auth/set-password', async () => {
    getSessionMock.mockResolvedValue({ user: { id: 'u1', needsPasswordSetup: true } })
    await expect(PlanStartPageContent({ locale: 'zh', draft: '' })).rejects.toThrow('NEXT_REDIRECT')
    expect(redirectMock).toHaveBeenCalledWith('/auth/set-password')
  })

  it('isAdmin && mustChangePassword → /auth/change-password', async () => {
    getSessionMock.mockResolvedValue({ user: { id: 'u1', isAdmin: true, mustChangePassword: true } })
    await expect(PlanStartPageContent({ locale: 'zh', draft: '' })).rejects.toThrow('NEXT_REDIRECT')
    expect(redirectMock).toHaveBeenCalledWith('/auth/change-password')
  })

  it('两项同时命中时先走 set-password（顺序与 (authed)/layout.tsx 一致）', async () => {
    getSessionMock.mockResolvedValue({
      user: { id: 'u1', needsPasswordSetup: true, isAdmin: true, mustChangePassword: true },
    })
    await expect(PlanStartPageContent({ locale: 'zh', draft: '' })).rejects.toThrow('NEXT_REDIRECT')
    expect(redirectMock).toHaveBeenCalledTimes(1)
    expect(redirectMock).toHaveBeenCalledWith('/auth/set-password')
  })
})
