import React from 'react'
import { t } from '@/lib/i18n'
import type { SupportedLocale } from '@/lib/i18n/types'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'

const signInMock = vi.fn()
const fetchMock = vi.fn()
let errorParam: string | null = null

vi.mock('next-auth/react', () => ({
  signIn: (...args: any[]) => signInMock(...args),
}))

vi.mock('next/navigation', () => ({
  useSearchParams: () => ({
    get: (key: string) => {
      if (key === 'callbackUrl') return '/'
      if (key === 'error') return errorParam
      return null
    },
  }),
}))

import SignInClient from '@/app/auth/signin/ui'

describe('auth/signin ui', () => {
  beforeEach(() => {
    errorParam = null
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
    render(<SignInClient locale="zh" />)

    expect(screen.getByRole('heading', { name: t('auth.signin.title', 'zh') })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: t('auth.signin.emailTab', 'zh') })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: t('auth.signin.passwordTab', 'zh') })).toBeInTheDocument()

    const emailForm = screen.getByRole('form', { name: t('auth.signin.emailForm', 'zh') })
    expect(within(emailForm).getByLabelText(t('auth.signin.email', 'zh'))).toBeInTheDocument()
    expect(within(emailForm).getByLabelText(t('auth.signin.code', 'zh'))).toBeInTheDocument()
    expect(within(emailForm).getByRole('button', { name: t('auth.signin.sendCode', 'zh') })).toBeInTheDocument()
    expect(within(emailForm).getByRole('button', { name: t('auth.signin.submit', 'zh') })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: t('auth.signin.passwordTab', 'zh') }))
    const passwordForm = screen.getByRole('form', { name: t('auth.signin.passwordForm', 'zh') })
    expect(within(passwordForm).getByLabelText(t('auth.signin.email', 'zh'))).toBeInTheDocument()
    expect(within(passwordForm).getByLabelText(t('auth.signin.password', 'zh'))).toBeInTheDocument()
    expect(within(passwordForm).getByRole('button', { name: t('auth.signin.submit', 'zh') })).toBeInTheDocument()
  })

  it.each(["$&", "$'", '$`', '$$'])('renders URL error %s literally', (value) => {
    errorParam = value
    render(<SignInClient locale="en" />)
    expect(screen.getByText(`Sign-in failed (${value})`)).toBeInTheDocument()
  })

  it('requests email otp code via /api/auth/request-code', async () => {
    render(<SignInClient locale="zh" />)
    const emailForm = screen.getByRole('form', { name: t('auth.signin.emailForm', 'zh') })
    fireEvent.change(within(emailForm).getByLabelText(t('auth.signin.email', 'zh')), { target: { value: 'user@example.com' } })
    fireEvent.click(within(emailForm).getByRole('button', { name: t('auth.signin.sendCode', 'zh') }))

    expect(fetchMock).toHaveBeenCalled()
    const [url, init] = fetchMock.mock.calls[0] as any[]
    expect(url).toBe('/api/auth/request-code')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(init?.body)).toEqual({ email: 'user@example.com', locale: 'zh' })
  })

  it.each<SupportedLocale>(['en', 'ja'])('sends the %s locale and localizes the signup link', (locale) => {
    render(<SignInClient locale={locale} />)
    expect(screen.getByRole('heading', { name: t('auth.signin.title', locale) })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: t('auth.signin.signup', locale) })).toHaveAttribute('href', `/${locale}/auth/signup`)

    const form = screen.getByRole('form', { name: t('auth.signin.emailForm', locale) })
    fireEvent.change(within(form).getByLabelText(t('auth.signin.email', locale)), { target: { value: 'user@example.com' } })
    fireEvent.click(within(form).getByRole('button', { name: t('auth.signin.sendCode', locale) }))
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ email: 'user@example.com', locale })
  })

  it('verifies email otp via NextAuth email-code credentials provider', async () => {
    render(<SignInClient locale="zh" />)
    const emailForm = screen.getByRole('form', { name: t('auth.signin.emailForm', 'zh') })
    fireEvent.change(within(emailForm).getByLabelText(t('auth.signin.email', 'zh')), { target: { value: 'user@example.com' } })
    fireEvent.change(within(emailForm).getByLabelText(t('auth.signin.code', 'zh')), { target: { value: '123456' } })
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
    render(<SignInClient locale="zh" />)
    fireEvent.click(screen.getByRole('button', { name: t('auth.signin.passwordTab', 'zh') }))
    const passwordForm = screen.getByRole('form', { name: t('auth.signin.passwordForm', 'zh') })
    fireEvent.change(within(passwordForm).getByLabelText(t('auth.signin.email', 'zh')), { target: { value: 'admin@example.com' } })
    fireEvent.change(within(passwordForm).getByLabelText(t('auth.signin.password', 'zh')), { target: { value: '112233' } })
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
