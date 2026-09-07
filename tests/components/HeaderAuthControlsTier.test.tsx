import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

const useSessionMock = vi.fn()
const useUsageMock = vi.fn()

vi.mock('next/link', () => ({
  default: ({ href, children, prefetch: _prefetch, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

vi.mock('next-auth/react', () => ({
  useSession: () => useSessionMock(),
}))

vi.mock('@/hooks/useUsage', () => ({
  useUsage: () => useUsageMock(),
}))

import HeaderAuthControls from '@/components/layout/HeaderAuthControls.client'

const labels = {
  admin: '管理员面板',
  favorites: '我的收藏',
  me: '我的',
  myHome: '我的主页',
  myMaps: '我的地图',
  myPlans: '我的巡礼计划',
  settings: '设置',
  submit: '投稿',
  signout: '退出',
  signin: '登录',
  signup: '注册',
  user: '用户',
}

function usageOf(tier: 'free' | 'standard' | 'pro') {
  return { usage: { tier }, status: 'ready', refresh: () => {} }
}

describe('HeaderAuthControls 套餐档位', () => {
  beforeEach(() => {
    useSessionMock.mockReset()
    useUsageMock.mockReset()
    useSessionMock.mockReturnValue({
      data: { user: { name: 'Test User', email: 'test@example.com', isAdmin: false } },
      status: 'authenticated',
    })
  })

  it('usage 为 standard 时给 Avatar 传 tier（出现 S 徽标）', () => {
    useUsageMock.mockReturnValue(usageOf('standard'))
    render(<HeaderAuthControls locale="zh" labels={labels} />)
    expect(screen.getByTestId('avatar-tier-badge')).toHaveTextContent('S')
  })

  it('usage 为 pro 时给 Avatar 传 tier（出现 P 徽标）', () => {
    useUsageMock.mockReturnValue(usageOf('pro'))
    render(<HeaderAuthControls locale="zh" labels={labels} />)
    expect(screen.getByTestId('avatar-tier-badge')).toHaveTextContent('P')
  })

  it('usage 为 free 时不显示徽标', () => {
    useUsageMock.mockReturnValue(usageOf('free'))
    render(<HeaderAuthControls locale="zh" labels={labels} />)
    expect(screen.queryByTestId('avatar-tier-badge')).toBeNull()
  })

  it('usage unavailable（null）时不传 tier', () => {
    useUsageMock.mockReturnValue({ usage: null, status: 'unavailable', refresh: () => {} })
    render(<HeaderAuthControls locale="zh" labels={labels} />)
    expect(screen.queryByTestId('avatar-tier-badge')).toBeNull()
  })

  it('drawer 布局：standard 时名字下方显示档位文字', () => {
    useUsageMock.mockReturnValue(usageOf('standard'))
    render(<HeaderAuthControls locale="zh" labels={labels} layout="drawer" />)
    expect(screen.getByText('标准')).toBeInTheDocument()
  })

  it('drawer 布局：free 不显示档位文字', () => {
    useUsageMock.mockReturnValue(usageOf('free'))
    render(<HeaderAuthControls locale="zh" labels={labels} layout="drawer" />)
    expect(screen.queryByText('免费')).toBeNull()
  })

  it('drawer 布局：unavailable 不显示档位文字', () => {
    useUsageMock.mockReturnValue({ usage: null, status: 'unavailable', refresh: () => {} })
    render(<HeaderAuthControls locale="zh" labels={labels} layout="drawer" />)
    expect(screen.queryByText('标准')).toBeNull()
    expect(screen.queryByText('高级')).toBeNull()
  })
})
