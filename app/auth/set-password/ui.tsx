"use client"

import { useState } from 'react'
import Image from 'next/image'
import Button from '@/components/shared/Button'
import { t } from '@/lib/i18n'
import type { SupportedLocale } from '@/lib/i18n/types'

export default function SetPasswordClient({ email, locale }: { email: string; locale: SupportedLocale }) {
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const inputClass =
    'w-full rounded-md border border-gray-200 bg-white px-3 py-2.5 text-sm shadow-sm placeholder:text-gray-400 focus:border-brand-200 focus:outline-none focus:ring-2 focus:ring-brand-100'
  const labelClass = 'block text-sm font-medium text-gray-900'

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (newPassword.length < 6) {
      setError(t('auth.setPassword.passwordTooShort', locale))
      return
    }
    if (newPassword !== confirmPassword) {
      setError(t('auth.setPassword.passwordMismatch', locale))
      return
    }

    setLoading(true)
    try {
      const res = await fetch('/api/auth/set-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPassword }),
      })
      if (!res.ok) {
        const errorKey = res.status === 401 ? 'unauthenticated'
          : res.status === 404 ? 'userNotFound'
          : res.status === 400 ? 'invalidRequest'
          : 'setFailed'
        setError(t(`auth.setPassword.${errorKey}`, locale))
        return
      }
    } catch {
      setError(t('auth.setPassword.setFailed', locale))
      return
    } finally {
      setLoading(false)
    }

    window.location.href = '/'
  }

  return (
    <div className="min-h-dvh bg-gradient-to-b from-brand-50 via-white to-white">
      <div className="mx-auto flex max-w-md flex-col px-4 py-12">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-2xl border border-pink-100 bg-white shadow-sm">
            <Image src="/brand/app-logo-64.png?v=2" alt="SeichiGo" width={44} height={44} className="h-11 w-11 object-cover" priority unoptimized />
          </div>
          <div className="min-w-0">
            <div className="font-display text-2xl font-bold leading-tight">SeichiGo</div>
            <div className="text-sm text-gray-600">{t('auth.setPassword.subtitle', locale)}</div>
          </div>
        </div>

        <div className="mt-8 rounded-2xl border border-pink-100 bg-white/80 p-6 shadow-sm backdrop-blur">
          <h1 className="text-xl font-bold">{t('auth.setPassword.title', locale)}</h1>
          <p className="mt-2 text-sm text-gray-600">
            {t('auth.setPassword.accountPrefix', locale)}<span className="font-medium text-gray-900">{email}</span>{t('auth.setPassword.accountSuffix', locale)}
          </p>

          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            <div>
              <label htmlFor="new-password" className={labelClass}>
                {t('auth.setPassword.newPassword', locale)}
              </label>
              <input
                id="new-password"
                className={`${inputClass} mt-1`}
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                required
              />
            </div>
            <div>
              <label htmlFor="confirm-password" className={labelClass}>
                {t('auth.setPassword.confirmPassword', locale)}
              </label>
              <input
                id="confirm-password"
                className={`${inputClass} mt-1`}
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                required
              />
            </div>

            {error ? <div className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</div> : null}

            <Button type="submit" disabled={loading} className="w-full">
              {loading ? t('auth.setPassword.submitting', locale) : t('auth.setPassword.submit', locale)}
            </Button>
          </form>
        </div>
      </div>
    </div>
  )
}
