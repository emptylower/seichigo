import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import SetPasswordClient from '@/app/auth/set-password/ui'
import { t } from '@/lib/i18n'
import type { SupportedLocale } from '@/lib/i18n/types'

const fetchMock = vi.fn()

describe('auth/set-password ui', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  function submit(locale: SupportedLocale, password: string, confirmation = password) {
    render(<SetPasswordClient email="user@example.com" locale={locale} />)
    fireEvent.change(screen.getByLabelText(t('auth.setPassword.newPassword', locale)), { target: { value: password } })
    fireEvent.change(screen.getByLabelText(t('auth.setPassword.confirmPassword', locale)), { target: { value: confirmation } })
    fireEvent.click(screen.getByRole('button', { name: t('auth.setPassword.submit', locale) }))
  }

  it.each<SupportedLocale>(['zh', 'en', 'ja'])('localizes short-password validation in %s', (locale) => {
    submit(locale, '12345')
    expect(screen.getByText(t('auth.setPassword.passwordTooShort', locale))).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each<SupportedLocale>(['zh', 'en', 'ja'])('localizes confirmation validation in %s', (locale) => {
    submit(locale, '123456', '654321')
    expect(screen.getByText(t('auth.setPassword.passwordMismatch', locale))).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  describe.each<SupportedLocale>(['zh', 'en', 'ja'])('%s API errors', (locale) => {
    it.each([
      { status: 401, error: '未登录', key: 'unauthenticated' },
      { status: 404, error: '用户不存在', key: 'userNotFound' },
      { status: 400, error: '参数错误', key: 'invalidRequest' },
      { status: 500, error: '服务异常', key: 'setFailed' },
    ])('localizes HTTP $status without displaying raw API text', async ({ status, error, key }) => {
      fetchMock.mockResolvedValue(new Response(JSON.stringify({ error }), { status }))
      submit(locale, '123456')
      expect(await screen.findByText(t(`auth.setPassword.${key}`, locale))).toBeInTheDocument()
      expect(fetchMock).toHaveBeenCalledWith('/api/auth/set-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPassword: '123456' }),
      })
      expect(screen.getByRole('button', { name: t('auth.setPassword.submit', locale) })).toBeEnabled()
      if (locale !== 'zh') expect(screen.queryByText(error)).not.toBeInTheDocument()
    })
  })

  it.each<SupportedLocale>(['en', 'ja'])('localizes network failures and allows retry in %s', async (locale) => {
    fetchMock.mockRejectedValue(new Error('Failed to fetch'))
    submit(locale, '123456')
    expect(await screen.findByText(t('auth.setPassword.setFailed', locale))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: t('auth.setPassword.submit', locale) })).toBeEnabled()
  })
})
