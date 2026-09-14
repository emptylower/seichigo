import { beforeEach, describe, expect, it, vi } from 'vitest'

const redirectMock = vi.hoisted(() => vi.fn())
const getLocaleMock = vi.hoisted(() => vi.fn())
const listPlansMock = vi.hoisted(() => vi.fn())
const createPlanMock = vi.hoisted(() => vi.fn())
const getSessionMock = vi.hoisted(() => vi.fn())

// Next 的 redirect() 通过抛错中止渲染；mock 保持同语义，catch 后断言目标
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    redirectMock(url)
    throw new Error(`NEXT_REDIRECT:${url}`)
  },
}))

vi.mock('@/lib/i18n/getLocale', () => ({
  getLocale: () => getLocaleMock(),
}))

// 新行为不应触碰计划数据：deps 全部置间谍，断言一次都没被调用
vi.mock('@/lib/tripPlan/api', () => ({
  getTripPlanApiDeps: vi.fn(async () => ({
    repo: { listPlans: listPlansMock, createPlan: createPlanMock },
    getSession: getSessionMock,
  })),
}))

import PlanIndexPage, { metadata } from '@/app/(authed)/plan/page'

describe('/plan 索引页：一律 307 到当前语言的 /plan/start', () => {
  beforeEach(() => {
    redirectMock.mockClear()
    getLocaleMock.mockReset()
    listPlansMock.mockClear()
    createPlanMock.mockClear()
    getSessionMock.mockClear()
  })

  it('zh → /plan/start（无前缀）', async () => {
    getLocaleMock.mockResolvedValue('zh')
    await expect(PlanIndexPage()).rejects.toThrow('NEXT_REDIRECT:/plan/start')
    expect(redirectMock).toHaveBeenCalledWith('/plan/start')
  })

  it('en → /en/plan/start', async () => {
    getLocaleMock.mockResolvedValue('en')
    await expect(PlanIndexPage()).rejects.toThrow('NEXT_REDIRECT:/en/plan/start')
    expect(redirectMock).toHaveBeenCalledWith('/en/plan/start')
  })

  it('ja → /ja/plan/start', async () => {
    getLocaleMock.mockResolvedValue('ja')
    await expect(PlanIndexPage()).rejects.toThrow('NEXT_REDIRECT:/ja/plan/start')
    expect(redirectMock).toHaveBeenCalledWith('/ja/plan/start')
  })

  it('不再查会话、查列表或创建默认计划（登录与游客同一逻辑）', async () => {
    getLocaleMock.mockResolvedValue('zh')
    await expect(PlanIndexPage()).rejects.toThrow('NEXT_REDIRECT')
    expect(getSessionMock).not.toHaveBeenCalled()
    expect(listPlansMock).not.toHaveBeenCalled()
    expect(createPlanMock).not.toHaveBeenCalled()
  })

  it('metadata 保持 noindex/nofollow', () => {
    expect(metadata.robots).toEqual({ index: false, follow: false })
  })
})
