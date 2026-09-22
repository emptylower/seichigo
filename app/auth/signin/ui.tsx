"use client"

import { useSearchParams } from 'next/navigation'
import { signIn } from 'next-auth/react'
import { useState } from 'react'
import Button from '@/components/shared/Button'
import Image from 'next/image'
import { useEmailCodeLogin } from '@/components/auth/useEmailCodeLogin'
import { track } from '@/lib/analytics/track'
import { t } from '@/lib/i18n'
import type { SupportedLocale } from '@/lib/i18n/types'
import { prefixPath } from '@/components/layout/prefixPath'

type SignInResult = {
  error?: string
  ok?: boolean
  status?: number
  url?: string | null
}

export default function SignInClient({ locale }: { locale: SupportedLocale }) {
  const searchParams = useSearchParams()
  const callbackUrl = searchParams.get('callbackUrl') || '/'
  const errorParam = searchParams.get('error')

  const [method, setMethod] = useState<'email' | 'password'>('email')

  // 邮箱验证码流程与首页登录弹窗共用一套逻辑（行为不变）
  const login = useEmailCodeLogin({ callbackUrl, locale })

  const [password, setPassword] = useState('')
  const [passwordLoading, setPasswordLoading] = useState(false)
  const [passwordError, setPasswordError] = useState<string | null>(null)

  async function requestCode(e: React.SyntheticEvent) {
    e.preventDefault()
    setPasswordError(null)
    await login.requestCode()
  }

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault()
    setPasswordError(null)
    const result = await login.verifyCode()
    if (!result.ok) return
    track('login', { method: 'email_code' })
    window.location.href = result.url
  }

  async function onPasswordSubmit(e: React.FormEvent) {
    e.preventDefault()
    setPasswordError(null)
    login.setError(null)
    login.setHint(null)
    const cleanedEmail = login.email.trim()
    if (!cleanedEmail) {
      setPasswordError(t('auth.signin.emailRequired', locale))
      return
    }
    if (!password) {
      setPasswordError(t('auth.signin.passwordRequired', locale))
      return
    }

    setPasswordLoading(true)
    const res = (await signIn('credentials', {
      email: cleanedEmail,
      password,
      redirect: false,
      callbackUrl,
    })) as SignInResult | undefined
    setPasswordLoading(false)
    if (!res) {
      setPasswordError(t('auth.signin.signInFailed', locale))
      return
    }
    if (res.error) {
      setPasswordError(t('auth.signin.invalidPassword', locale))
      return
    }
    track('login', { method: 'credentials' })
    window.location.href = res.url || callbackUrl
  }

  const inputClass =
    'w-full rounded-md border border-gray-200 bg-white px-3 py-2.5 text-sm shadow-sm placeholder:text-gray-400 focus:border-brand-200 focus:outline-none focus:ring-2 focus:ring-brand-100'
  const labelClass = 'block text-sm font-medium text-gray-900'

  return (
    <div className="min-h-dvh bg-gradient-to-b from-brand-50 via-white to-white">
      <div className="mx-auto flex max-w-md flex-col px-4 py-8 sm:py-12">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-2xl border border-pink-100 bg-white shadow-sm">
            <Image src="/brand/app-logo-64.png?v=2" alt="SeichiGo" width={44} height={44} className="h-11 w-11 object-cover" priority unoptimized />
          </div>
          <div className="min-w-0">
            <div className="font-display text-2xl font-bold leading-tight">SeichiGo</div>
            <div className="text-sm text-gray-600">{t('auth.signin.subtitle', locale)}</div>
          </div>
        </div>

        <div className="mt-8 rounded-2xl border border-pink-100 bg-white/80 p-5 shadow-sm backdrop-blur sm:p-6">
          <h1 className="text-xl font-bold">{t('auth.signin.title', locale)}</h1>

          {errorParam ? (
            <div className="mt-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{t('auth.signin.errorWithCode', locale).replace('{error}', () => errorParam)}</div>
          ) : null}

          <div className="mt-5 grid grid-cols-2 gap-1 rounded-xl bg-pink-50 p-1">
            <button
              type="button"
              className={[
                'rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                method === 'email' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900',
              ].join(' ')}
              onClick={() => setMethod('email')}
            >
              {t('auth.signin.emailTab', locale)}
            </button>
            <button
              type="button"
              className={[
                'rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                method === 'password' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900',
              ].join(' ')}
              onClick={() => setMethod('password')}
            >
              {t('auth.signin.passwordTab', locale)}
            </button>
          </div>

          {method === 'email' ? (
            <form aria-label={t('auth.signin.emailForm', locale)} onSubmit={verifyCode} className="mt-6 space-y-4">
              <div>
                <label htmlFor="login-email" className={labelClass}>
                  {t('auth.signin.email', locale)}
                </label>
                <div className="mt-1 flex flex-col gap-2 sm:flex-row">
                  <input
                    id="login-email"
                    className={inputClass}
                    type="email"
                    value={login.email}
                    onChange={(e) => login.setEmail(e.target.value)}
                    autoComplete="email"
                    required
                  />
                  <Button type="button" variant="ghost" disabled={!login.canSendCode} onClick={requestCode} className="h-11 shrink-0 whitespace-nowrap sm:h-auto">
                    {login.sendLabel}
                  </Button>
                </div>
              </div>

              <div>
                <label htmlFor="login-code" className={labelClass}>
                  {t('auth.signin.code', locale)}
                </label>
                <input
                  id="login-code"
                  className={`${inputClass} mt-1`}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder={t('auth.signin.codePlaceholder', locale)}
                  value={login.code}
                  onChange={(e) => login.setCode(e.target.value)}
                  required
                />
              </div>

              {login.hint ? <div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">{login.hint}</div> : null}
              {login.error ? <div className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{login.error}</div> : null}

              <Button type="submit" disabled={login.loading === 'email-verify'} className="h-11 w-full">
                {login.loading === 'email-verify' ? t('auth.signin.verifying', locale) : t('auth.signin.submit', locale)}
              </Button>
            </form>
          ) : (
            <form aria-label={t('auth.signin.passwordForm', locale)} onSubmit={onPasswordSubmit} className="mt-6 space-y-4">
              <div>
                <label htmlFor="password-email" className={labelClass}>
                  {t('auth.signin.email', locale)}
                </label>
                <input
                  id="password-email"
                  className={`${inputClass} mt-1`}
                  type="email"
                  value={login.email}
                  onChange={(e) => login.setEmail(e.target.value)}
                  autoComplete="email"
                  required
                />
              </div>
              <div>
                <label htmlFor="password-password" className={labelClass}>
                  {t('auth.signin.password', locale)}
                </label>
                <input
                  id="password-password"
                  className={`${inputClass} mt-1`}
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                />
              </div>

              {passwordError ? <div className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{passwordError}</div> : null}

              <Button type="submit" disabled={passwordLoading} className="h-11 w-full">
                {passwordLoading ? t('auth.signin.signingIn', locale) : t('auth.signin.submit', locale)}
              </Button>
            </form>
          )}

          <div className="mt-6 text-xs text-gray-500">
            {t('auth.signin.consent', locale)}
          </div>

          <div className="mt-4 text-center text-sm text-gray-500">
            {t('auth.signin.noAccount', locale)}{' '}
            <a href={prefixPath('/auth/signup', locale)} className="text-brand-600 hover:underline">
              {t('auth.signin.signup', locale)}
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
