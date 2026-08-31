import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

const useSessionMock = vi.fn()

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

import HeaderAuthControls from '@/components/layout/HeaderAuthControls.client'

describe('HeaderAuthControls', () => {
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

  beforeEach(() => {
    useSessionMock.mockReset()
  })

  it('renders anonymous controls while session is loading', () => {
    useSessionMock.mockReturnValue({
      data: null,
      status: 'loading',
    })

    render(<HeaderAuthControls locale="zh" labels={labels} />)

    expect(screen.getByRole('link', { name: labels.signin })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: labels.signup })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: labels.admin })).toBeNull()
  })

  it('shows admin entry inside avatar dropdown for admin users', () => {
    useSessionMock.mockReturnValue({
      data: {
        user: {
          name: 'lijianjie',
          email: 'lijianjie@koi.codes',
          isAdmin: true,
        },
      },
      status: 'authenticated',
    })

    render(<HeaderAuthControls locale="zh" labels={labels} />)

    const admin = screen.getByRole('link', { name: labels.admin })
    expect(admin.getAttribute('href')).toContain('/admin')
    expect(admin.closest('details')).not.toBeNull()
    expect(screen.getAllByRole('link', { name: labels.admin })).toHaveLength(1)
    expect(screen.queryByRole('link', { name: labels.signin })).toBeNull()
    expect(screen.queryByRole('link', { name: labels.signup })).toBeNull()
  })

  it('renders stack layout entries for drawer mode', () => {
    useSessionMock.mockReturnValue({
      data: {
        user: {
          name: 'Test User',
          email: 'test@example.com',
          isAdmin: false,
        },
      },
      status: 'authenticated',
    })

    render(<HeaderAuthControls locale="zh" labels={labels} layout="stack" />)

    expect(screen.getByRole('link', { name: labels.myHome })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: labels.settings })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: labels.myMaps })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: labels.myPlans })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: labels.submit })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: labels.admin })).toBeNull()
    expect(screen.getByRole('link', { name: labels.favorites })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: labels.signout })).toBeInTheDocument()
  })

  it('hides admin entry for non-admin users in inline layout', () => {
    useSessionMock.mockReturnValue({
      data: {
        user: {
          name: 'Normal User',
          email: 'normal@example.com',
          isAdmin: false,
        },
      },
      status: 'authenticated',
    })

    render(<HeaderAuthControls locale="zh" labels={labels} />)

    expect(screen.queryByRole('link', { name: labels.admin })).toBeNull()
    expect(screen.getByRole('link', { name: labels.favorites })).toBeInTheDocument()
  })
})
