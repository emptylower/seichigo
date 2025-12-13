import React from 'react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'

const signInMock = vi.fn()

vi.mock('next-auth/react', () => ({
  signIn: (...args: any[]) => signInMock(...args),
}))

vi.mock('next/navigation', () => ({
  useSearchParams: () => ({
    get: (key: string) => {
      if (key === 'callbackUrl') return '/'
      return null
    },
  }),
}))

import SignInClient from '@/app/auth/signin/ui'

describe('auth/signin ui', () => {
  beforeEach(() => {
    signInMock.mockReset()
    signInMock.mockResolvedValue({ error: 'MockError' })
  })

  it('renders email sign-in and admin credentials sign-in', () => {
    render(<SignInClient />)

    expect(screen.getByRole('heading', { name: '登录' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '邮箱登录' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '管理员登录' })).toBeInTheDocument()

    const emailForm = screen.getByRole('form', { name: '邮箱登录表单' })
    expect(within(emailForm).getByLabelText('邮箱')).toBeInTheDocument()
    expect(within(emailForm).getByRole('button', { name: '发送登录链接' })).toBeInTheDocument()

    const adminForm = screen.getByRole('form', { name: '管理员登录表单' })
    expect(within(adminForm).getByLabelText('邮箱')).toBeInTheDocument()
    expect(within(adminForm).getByLabelText('密码')).toBeInTheDocument()
    expect(within(adminForm).getByRole('button', { name: '登录' })).toBeInTheDocument()
  })

  it('submits email sign-in via NextAuth email provider', async () => {
    render(<SignInClient />)
    const emailForm = screen.getByRole('form', { name: '邮箱登录表单' })
    fireEvent.change(within(emailForm).getByLabelText('邮箱'), { target: { value: 'user@example.com' } })
    fireEvent.submit(emailForm)

    expect(signInMock).toHaveBeenCalledWith(
      'email',
      expect.objectContaining({
        email: 'user@example.com',
        redirect: false,
        callbackUrl: '/',
      })
    )
  })

  it('submits admin sign-in via NextAuth credentials provider', async () => {
    render(<SignInClient />)
    const adminForm = screen.getByRole('form', { name: '管理员登录表单' })
    fireEvent.change(within(adminForm).getByLabelText('邮箱'), { target: { value: 'admin@example.com' } })
    fireEvent.change(within(adminForm).getByLabelText('密码'), { target: { value: '112233' } })
    fireEvent.submit(adminForm)

    expect(signInMock).toHaveBeenCalledWith(
      'credentials',
      expect.objectContaining({
        email: 'admin@example.com',
        password: '112233',
        redirect: false,
        callbackUrl: '/',
      })
    )
  })
})

