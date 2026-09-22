'use client'

import { signIn } from 'next-auth/react'
import Link from 'next/link'
import Image from 'next/image'
import { useEffect, useMemo, useState } from 'react'
import Button from '@/components/shared/Button'
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

export default function SignUpClient({ locale }: { locale: SupportedLocale }) {
  const callbackUrl = prefixPath('/auth/set-password', locale)

  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')

  const [loading, setLoading] = useState<'email-send' | 'email-verify' | null>(null)

  const [emailHint, setEmailHint] = useState<string | null>(null)
  const [emailError, setEmailError] = useState<string | null>(null)

  const [cooldown, setCooldown] = useState(0)

  useEffect(() => {
    if (cooldown <= 0) return
    const t = window.setInterval(() => setCooldown((s) => Math.max(0, s - 1)), 1000)
    return () => window.clearInterval(t)
  }, [cooldown])

  const canSendCode = cooldown <= 0 && loading !== 'email-send'
  const sendLabel = useMemo(() => {
    if (loading === 'email-send') return t('auth.signup.sending', locale)
    if (cooldown > 0) return t('auth.signup.resend', locale).replace('{seconds}', String(cooldown))
    return t('auth.signup.sendCode', locale)
  }, [cooldown, loading, locale])

  async function requestCode(e: React.SyntheticEvent) {
    e.preventDefault()
    setEmailError(null)
    setEmailHint(null)

    const cleanedEmail = email.trim()
    if (!cleanedEmail) {
      setEmailError(t('auth.signup.emailRequired', locale))
      return
    }

    setLoading('email-send')
    const res = await fetch('/api/auth/request-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: cleanedEmail, locale }),
    })
    setLoading(null)

    const j = await res.json().catch(() => ({}))
    if (!res.ok) {
      const msg = j?.error || t('auth.signup.sendFailed', locale)
      setEmailError(msg)
      if (res.status === 429 && typeof j?.retryAfterSeconds === 'number') {
        setCooldown(Math.max(1, Math.min(60, Math.floor(j.retryAfterSeconds))))
      }
      return
    }

    const seconds = typeof j?.cooldownSeconds === 'number' ? Math.floor(j.cooldownSeconds) : 60
    setCooldown(Math.max(1, Math.min(60, seconds)))
    setEmailHint(t('auth.signup.codeSent', locale))
  }

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault()
    setEmailError(null)
    setEmailHint(null)

    const cleanedEmail = email.trim()
    const cleanedCode = code.trim()
    if (!cleanedEmail) {
      setEmailError(t('auth.signup.emailRequired', locale))
      return
    }
    if (!cleanedCode) {
      setEmailError(t('auth.signup.codeRequired', locale))
      return
    }

    setLoading('email-verify')
    const res = (await signIn('email-code', {
      email: cleanedEmail,
      code: cleanedCode,
      redirect: false,
      callbackUrl,
    })) as SignInResult | undefined
    setLoading(null)

    if (!res) {
      setEmailError(t('auth.signup.signupFailed', locale))
      return
    }
    if (res.error) {
      setEmailError(t('auth.signup.invalidCode', locale))
      return
    }

    // 只有走注册页成功的才算 sign_up（同一套验证码流程对新老用户无差别，
    // 登录页/弹窗一律记 login）
    track('sign_up', { method: 'email_code' })
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
            <div className="text-sm text-gray-600">{t('auth.signup.subtitle', locale)}</div>
          </div>
        </div>

        <div className="mt-8 rounded-2xl border border-pink-100 bg-white/80 p-5 shadow-sm backdrop-blur sm:p-6">
          <h1 className="text-xl font-bold">{t('auth.signup.title', locale)}</h1>

          <form aria-label={t('auth.signup.form', locale)} onSubmit={verifyCode} className="mt-6 space-y-4">
            <div>
              <label htmlFor="signup-email" className={labelClass}>
                {t('auth.signup.email', locale)}
              </label>
              <div className="mt-1 flex flex-col gap-2 sm:flex-row">
                <input
                  id="signup-email"
                  className={inputClass}
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  required
                />
                <Button type="button" variant="ghost" disabled={!canSendCode} onClick={requestCode} className="h-11 shrink-0 whitespace-nowrap sm:h-auto">
                  {sendLabel}
                </Button>
              </div>
            </div>

            <div>
              <label htmlFor="signup-code" className={labelClass}>
                {t('auth.signup.code', locale)}
              </label>
              <input
                id="signup-code"
                className={`${inputClass} mt-1`}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder={t('auth.signup.codePlaceholder', locale)}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
              />
            </div>

            {emailHint ? <div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">{emailHint}</div> : null}
            {emailError ? <div className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{emailError}</div> : null}

            <Button type="submit" disabled={loading === 'email-verify'} className="h-11 w-full">
              {loading === 'email-verify' ? t('auth.signup.verifying', locale) : t('auth.signup.submit', locale)}
            </Button>
          </form>

          <div className="mt-6 text-center text-sm text-gray-500">
            {t('auth.signup.hasAccount', locale)}{' '}
            <Link href={prefixPath('/auth/signin', locale)} className="text-brand-600 hover:underline">
              {t('auth.signup.signin', locale)}
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
