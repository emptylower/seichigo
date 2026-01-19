"use client"

import { useSearchParams } from 'next/navigation'
import { signIn } from 'next-auth/react'
import { useEffect, useMemo, useState } from 'react'
import Button from '@/components/shared/Button'
import Image from 'next/image'

type SignInResult = {
  error?: string
  ok?: boolean
  status?: number
  url?: string | null
}

export default function SignInClient() {
  const searchParams = useSearchParams()
  const callbackUrl = searchParams.get('callbackUrl') || '/'
  const errorParam = searchParams.get('error')

  const [method, setMethod] = useState<'email' | 'password'>('email')

  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')

  const [loading, setLoading] = useState<'email-send' | 'email-verify' | 'password' | null>(null)

  const [emailHint, setEmailHint] = useState<string | null>(null)
  const [emailError, setEmailError] = useState<string | null>(null)
  const [passwordError, setPasswordError] = useState<string | null>(null)

  const [cooldown, setCooldown] = useState(0)

  useEffect(() => {
    if (cooldown <= 0) return
    const t = window.setInterval(() => setCooldown((s) => Math.max(0, s - 1)), 1000)
    return () => window.clearInterval(t)
  }, [cooldown])

  const canSendCode = cooldown <= 0 && loading !== 'email-send'
  const sendLabel = useMemo(() => {
    if (loading === 'email-send') return '发送中…'
    if (cooldown > 0) return `重新发送（${cooldown}s）`
    return '发送验证码'
  }, [cooldown, loading])

  async function requestCode(e: React.SyntheticEvent) {
    e.preventDefault()
    setEmailError(null)
    setEmailHint(null)
    setPasswordError(null)

    const cleanedEmail = email.trim()
    if (!cleanedEmail) {
      setEmailError('请填写邮箱')
      return
    }

    setLoading('email-send')
    const res = await fetch('/api/auth/request-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: cleanedEmail }),
    })
    setLoading(null)

    const j = await res.json().catch(() => ({}))
    if (!res.ok) {
      const msg = j?.error || '发送失败，请稍后重试'
      setEmailError(msg)
      if (res.status === 429 && typeof j?.retryAfterSeconds === 'number') {
        setCooldown(Math.max(1, Math.min(60, Math.floor(j.retryAfterSeconds))))
      }
      return
    }

    const seconds = typeof j?.cooldownSeconds === 'number' ? Math.floor(j.cooldownSeconds) : 60
    setCooldown(Math.max(1, Math.min(60, seconds)))
    setEmailHint('验证码已发送，请查收邮件。')
  }

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault()
    setEmailError(null)
    setEmailHint(null)
    setPasswordError(null)

    const cleanedEmail = email.trim()
    const cleanedCode = code.trim()
    if (!cleanedEmail) {
      setEmailError('请填写邮箱')
      return
    }
    if (!cleanedCode) {
      setEmailError('请填写验证码')
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
      setEmailError('登录失败，请稍后重试')
      return
    }
    if (res.error) {
      setEmailError('验证码不正确或已过期')
      return
    }
    window.location.href = res.url || callbackUrl
  }

  async function onPasswordSubmit(e: React.FormEvent) {
    e.preventDefault()
    setPasswordError(null)
    setEmailError(null)
    setEmailHint(null)
    const cleanedEmail = email.trim()
    if (!cleanedEmail) {
      setPasswordError('请填写邮箱')
      return
    }
    if (!password) {
      setPasswordError('请填写密码')
      return
    }

    setLoading('password')
    const res = (await signIn('credentials', {
      email: cleanedEmail,
      password,
      redirect: false,
      callbackUrl,
    })) as SignInResult | undefined
    setLoading(null)
    if (!res) {
      setPasswordError('登录失败，请稍后重试')
      return
    }
    if (res.error) {
      setPasswordError('邮箱或密码不正确，或该账号未开通账密登录')
      return
    }
    window.location.href = res.url || callbackUrl
  }

  const inputClass =
    'w-full rounded-md border border-gray-200 bg-white px-3 py-2.5 text-sm shadow-sm placeholder:text-gray-400 focus:border-brand-200 focus:outline-none focus:ring-2 focus:ring-brand-100'
  const labelClass = 'block text-sm font-medium text-gray-900'

  return (
    <div className="min-h-dvh bg-gradient-to-b from-brand-50 via-white to-white">
      <div className="mx-auto flex max-w-md flex-col px-4 py-12">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-2xl border border-pink-100 bg-white shadow-sm">
            <Image src="/brand/app-logo.png" alt="SeichiGo" width={44} height={44} className="h-11 w-11 object-cover" priority />
          </div>
          <div className="min-w-0">
            <div className="font-display text-2xl font-bold leading-tight">SeichiGo</div>
            <div className="text-sm text-gray-600">登录后开始创作与巡礼</div>
          </div>
        </div>

        <div className="mt-8 rounded-2xl border border-pink-100 bg-white/80 p-6 shadow-sm backdrop-blur">
          <h1 className="text-xl font-bold">登录</h1>

          {errorParam ? (
            <div className="mt-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">登录失败（{errorParam}）</div>
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
              邮箱登录
            </button>
            <button
              type="button"
              className={[
                'rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                method === 'password' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900',
              ].join(' ')}
              onClick={() => setMethod('password')}
            >
              账号密码
            </button>
          </div>

          {method === 'email' ? (
            <form aria-label="邮箱登录表单" onSubmit={verifyCode} className="mt-6 space-y-4">
              <div>
                <label htmlFor="login-email" className={labelClass}>
                  邮箱
                </label>
                <div className="mt-1 flex gap-2">
                  <input
                    id="login-email"
                    className={inputClass}
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                    required
                  />
                  <Button type="button" variant="ghost" disabled={!canSendCode} onClick={requestCode} className="shrink-0 whitespace-nowrap">
                    {sendLabel}
                  </Button>
                </div>
              </div>

              <div>
                <label htmlFor="login-code" className={labelClass}>
                  验证码
                </label>
                <input
                  id="login-code"
                  className={`${inputClass} mt-1`}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="6 位验证码"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  required
                />
              </div>

              {emailHint ? <div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">{emailHint}</div> : null}
              {emailError ? <div className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{emailError}</div> : null}

              <Button type="submit" disabled={loading === 'email-verify'} className="w-full">
                {loading === 'email-verify' ? '验证中…' : '登录'}
              </Button>
            </form>
          ) : (
            <form aria-label="账号密码登录表单" onSubmit={onPasswordSubmit} className="mt-6 space-y-4">
              <div>
                <label htmlFor="password-email" className={labelClass}>
                  邮箱
                </label>
                <input
                  id="password-email"
                  className={`${inputClass} mt-1`}
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  required
                />
              </div>
              <div>
                <label htmlFor="password-password" className={labelClass}>
                  密码
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

              <Button type="submit" disabled={loading === 'password'} className="w-full">
                {loading === 'password' ? '登录中…' : '登录'}
              </Button>
            </form>
          )}

          <div className="mt-6 text-xs text-gray-500">
            登录即表示你同意我们对账号信息进行必要的存储与处理，用于投稿与审核流程。
          </div>

          <div className="mt-4 text-center text-sm text-gray-500">
            还没有账号？{' '}
            <a href="/auth/signup" className="text-brand-600 hover:underline">
              立即注册
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
