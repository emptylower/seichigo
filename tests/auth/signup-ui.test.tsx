import React from 'react'
import { t } from '@/lib/i18n'
import type { SupportedLocale } from '@/lib/i18n/types'
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
    render(<SignUpClient locale="zh" />)

    expect(screen.getByRole('heading', { name: t('auth.signup.title', 'zh') })).toBeInTheDocument()

    const form = screen.getByRole('form', { name: t('auth.signup.form', 'zh') })
    expect(within(form).getByLabelText(t('auth.signup.email', 'zh'))).toBeInTheDocument()
    expect(within(form).getByLabelText(t('auth.signup.code', 'zh'))).toBeInTheDocument()

    expect(within(form).getByRole('button', { name: t('auth.signup.sendCode', 'zh') })).toBeInTheDocument()
    expect(within(form).getByRole('button', { name: t('auth.signup.submit', 'zh') })).toBeInTheDocument()

    expect(screen.getByRole('link', { name: t('auth.signup.signin', 'zh') })).toHaveAttribute('href', '/auth/signin')
  })

  it('requests email otp code via /api/auth/request-code', async () => {
    render(<SignUpClient locale="zh" />)

    const form = screen.getByRole('form', { name: t('auth.signup.form', 'zh') })
    fireEvent.change(within(form).getByLabelText(t('auth.signup.email', 'zh')), { target: { value: 'user@example.com' } })
    fireEvent.click(within(form).getByRole('button', { name: t('auth.signup.sendCode', 'zh') }))

    expect(fetchMock).toHaveBeenCalled()
    const [url, init] = fetchMock.mock.calls[0] as any[]
    expect(url).toBe('/api/auth/request-code')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(init?.body)).toEqual({ email: 'user@example.com', locale: 'zh' })
  })

  it.each<SupportedLocale>(['en', 'ja'])('sends the %s locale and localizes the signin link', (locale) => {
    render(<SignUpClient locale={locale} />)
    expect(screen.getByRole('heading', { name: t('auth.signup.title', locale) })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: t('auth.signup.signin', locale) })).toHaveAttribute('href', `/${locale}/auth/signin`)

    const form = screen.getByRole('form', { name: t('auth.signup.form', locale) })
    fireEvent.change(within(form).getByLabelText(t('auth.signup.email', locale)), { target: { value: 'user@example.com' } })
    fireEvent.click(within(form).getByRole('button', { name: t('auth.signup.sendCode', locale) }))
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ email: 'user@example.com', locale })
  })

  it.each<SupportedLocale>(['zh', 'en', 'ja'])('preserves the %s locale in the set-password callback', async (locale) => {
    render(<SignUpClient locale={locale} />)

    const form = screen.getByRole('form', { name: t('auth.signup.form', locale) })
    fireEvent.change(within(form).getByLabelText(t('auth.signup.email', locale)), { target: { value: 'user@example.com' } })
    fireEvent.change(within(form).getByLabelText(t('auth.signup.code', locale)), { target: { value: '123456' } })
    fireEvent.submit(form)

    expect(signInMock).toHaveBeenCalledWith(
      'email-code',
      expect.objectContaining({
        email: 'user@example.com',
        code: '123456',
        redirect: false,
        callbackUrl: locale === 'zh' ? '/auth/set-password' : `/${locale}/auth/set-password`,
      })
    )
  })
})
