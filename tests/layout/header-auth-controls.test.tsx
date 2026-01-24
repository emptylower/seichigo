import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

import HeaderAuthControls from '@/components/layout/HeaderAuthControls.client'

describe('HeaderAuthControls', () => {
  const labels = {
    admin: '管理员面板',
    favorites: '我的收藏',
    signout: '退出',
    signin: '登录',
    signup: '注册',
    user: '用户',
  }

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('retries session fetch once when first response is anonymous', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({}), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            user: {
              name: 'lijianjie',
              email: 'lijianjie@koi.codes',
              isAdmin: true,
            },
            expires: new Date(Date.now() + 60_000).toISOString(),
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      )

    ;(globalThis as any).fetch = fetchMock

    render(<HeaderAuthControls locale="zh" labels={labels} />)

    // Initial render keeps anonymous controls until loaded.
    expect(screen.getByRole('link', { name: labels.signin })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: labels.signup })).toBeInTheDocument()

    await act(async () => {
      await Promise.resolve()
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // Trigger the retry timer.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
      await Promise.resolve()
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)

    // After retry, it should render authenticated controls.
    const admin = screen.getByRole('link', { name: labels.admin })
    expect(admin.getAttribute('href')).toContain('/admin')
    expect(screen.queryByRole('link', { name: labels.signin })).toBeNull()
    expect(screen.queryByRole('link', { name: labels.signup })).toBeNull()
  })
})
