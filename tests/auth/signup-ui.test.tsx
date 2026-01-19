import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'

const signInMock = vi.fn()
const fetchMock = vi.fn()

vi.mock('next-auth/react', () => ({
  signIn: (...args: any[]) => signInMock(...args),
}))

import SignUpClient from '@/app/auth/signup/ui'

describe('auth/signup ui', () => {
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

  it('renders signup form and link to signin', () => {
    render(<SignUpClient />)

    expect(screen.getByRole('heading', { name: '注册' })).toBeInTheDocument()

    const form = screen.getByRole('form', { name: '注册表单' })
    expect(within(form).getByLabelText('邮箱')).toBeInTheDocument()
    expect(within(form).getByLabelText('验证码')).toBeInTheDocument()

    expect(within(form).getByRole('button', { name: '发送验证码' })).toBeInTheDocument()
    expect(within(form).getByRole('button', { name: '注册并继续' })).toBeInTheDocument()

    expect(screen.getByRole('link', { name: '去登录' })).toHaveAttribute('href', '/auth/signin')
  })

  it('requests email otp code via /api/auth/request-code', async () => {
    render(<SignUpClient />)

    const form = screen.getByRole('form', { name: '注册表单' })
    fireEvent.change(within(form).getByLabelText('邮箱'), { target: { value: 'user@example.com' } })
    fireEvent.click(within(form).getByRole('button', { name: '发送验证码' }))

    expect(fetchMock).toHaveBeenCalled()
    const [url, init] = fetchMock.mock.calls[0] as any[]
    expect(url).toBe('/api/auth/request-code')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(init?.body)).toEqual({ email: 'user@example.com' })
  })

  it('verifies email otp via NextAuth email-code credentials provider with callbackUrl /auth/set-password', async () => {
    render(<SignUpClient />)

    const form = screen.getByRole('form', { name: '注册表单' })
    fireEvent.change(within(form).getByLabelText('邮箱'), { target: { value: 'user@example.com' } })
    fireEvent.change(within(form).getByLabelText('验证码'), { target: { value: '123456' } })
    fireEvent.submit(form)

    expect(signInMock).toHaveBeenCalledWith(
      'email-code',
      expect.objectContaining({
        email: 'user@example.com',
        code: '123456',
        redirect: false,
        callbackUrl: '/auth/set-password',
      })
    )
  })
})
