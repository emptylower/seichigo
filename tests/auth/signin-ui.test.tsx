import React from 'react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'

const signInMock = vi.fn()
const fetchMock = vi.fn()

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
    fetchMock.mockReset()
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true, cooldownSeconds: 60, expiresAt: new Date().toISOString() }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )
    ;(globalThis as any).fetch = fetchMock
  })

  it('renders email sign-in and password sign-in tabs', () => {
    render(<SignInClient />)

    expect(screen.getByRole('heading', { name: '登录' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '邮箱登录' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '账号密码' })).toBeInTheDocument()

    const emailForm = screen.getByRole('form', { name: '邮箱登录表单' })
    expect(within(emailForm).getByLabelText('邮箱')).toBeInTheDocument()
    expect(within(emailForm).getByLabelText('验证码')).toBeInTheDocument()
    expect(within(emailForm).getByRole('button', { name: '发送验证码' })).toBeInTheDocument()
    expect(within(emailForm).getByRole('button', { name: '登录' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '账号密码' }))
    const passwordForm = screen.getByRole('form', { name: '账号密码登录表单' })
    expect(within(passwordForm).getByLabelText('邮箱')).toBeInTheDocument()
    expect(within(passwordForm).getByLabelText('密码')).toBeInTheDocument()
    expect(within(passwordForm).getByRole('button', { name: '登录' })).toBeInTheDocument()
  })

  it('requests email otp code via /api/auth/request-code', async () => {
    render(<SignInClient />)
    const emailForm = screen.getByRole('form', { name: '邮箱登录表单' })
    fireEvent.change(within(emailForm).getByLabelText('邮箱'), { target: { value: 'user@example.com' } })
    fireEvent.click(within(emailForm).getByRole('button', { name: '发送验证码' }))

    expect(fetchMock).toHaveBeenCalled()
    const [url, init] = fetchMock.mock.calls[0] as any[]
    expect(url).toBe('/api/auth/request-code')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(init?.body)).toEqual({ email: 'user@example.com' })
  })

  it('verifies email otp via NextAuth email-code credentials provider', async () => {
    render(<SignInClient />)
    const emailForm = screen.getByRole('form', { name: '邮箱登录表单' })
    fireEvent.change(within(emailForm).getByLabelText('邮箱'), { target: { value: 'user@example.com' } })
    fireEvent.change(within(emailForm).getByLabelText('验证码'), { target: { value: '123456' } })
    fireEvent.submit(emailForm)

    expect(signInMock).toHaveBeenCalledWith(
      'email-code',
      expect.objectContaining({
        email: 'user@example.com',
        code: '123456',
        redirect: false,
        callbackUrl: '/',
      })
    )
  })

  it('submits password sign-in via NextAuth credentials provider', async () => {
    render(<SignInClient />)
    fireEvent.click(screen.getByRole('button', { name: '账号密码' }))
    const passwordForm = screen.getByRole('form', { name: '账号密码登录表单' })
    fireEvent.change(within(passwordForm).getByLabelText('邮箱'), { target: { value: 'admin@example.com' } })
    fireEvent.change(within(passwordForm).getByLabelText('密码'), { target: { value: '112233' } })
    fireEvent.submit(passwordForm)

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
