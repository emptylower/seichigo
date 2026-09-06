'use client'

import { useEffect, useMemo, useState } from 'react'
import { signIn } from 'next-auth/react'

type SignInResult = {
  error?: string
  ok?: boolean
  status?: number
  url?: string | null
}

export type EmailCodeLoginLoading = 'email-send' | 'email-verify' | null

export type VerifyCodeResult = { ok: true; url: string } | { ok: false }

/**
 * 邮箱验证码登录的可复用逻辑（登录页与首页登录弹窗共用）：
 * `POST /api/auth/request-code` 发码（带 60s 冷却与 429 退避），
 * 再 `signIn('email-code', { redirect: false })` 校验。
 *
 * 只负责请求与状态，不做跳转——登录页跳 callbackUrl，弹窗则回调 onSuccess
 * 留在原页面继续原来的动作。
 */
export function useEmailCodeLogin(options: { callbackUrl?: string } = {}) {
  const callbackUrl = options.callbackUrl ?? '/'

  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState<EmailCodeLoginLoading>(null)
  const [hint, setHint] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
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

  async function requestCode(): Promise<void> {
    setError(null)
    setHint(null)

    const cleanedEmail = email.trim()
    if (!cleanedEmail) {
      setError('请填写邮箱')
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
      setError(j?.error || '发送失败，请稍后重试')
      if (res.status === 429 && typeof j?.retryAfterSeconds === 'number') {
        setCooldown(Math.max(1, Math.min(60, Math.floor(j.retryAfterSeconds))))
      }
      return
    }

    const seconds = typeof j?.cooldownSeconds === 'number' ? Math.floor(j.cooldownSeconds) : 60
    setCooldown(Math.max(1, Math.min(60, seconds)))
    setHint('验证码已发送，请查收邮件。')
  }

  /** 校验验证码；成功时返回登录后应去的 url（调用方决定跳转与否） */
  async function verifyCode(): Promise<VerifyCodeResult> {
    setError(null)
    setHint(null)

    const cleanedEmail = email.trim()
    const cleanedCode = code.trim()
    if (!cleanedEmail) {
      setError('请填写邮箱')
      return { ok: false }
    }
    if (!cleanedCode) {
      setError('请填写验证码')
      return { ok: false }
    }

    setLoading('email-verify')
    const res = (await signIn('email-code', {
      email: cleanedEmail,
      code: cleanedCode,
      redirect: false,
      ...(options.callbackUrl ? { callbackUrl } : {}),
    })) as SignInResult | undefined
    setLoading(null)

    if (!res) {
      setError('登录失败，请稍后重试')
      return { ok: false }
    }
    if (res.error) {
      setError('验证码不正确或已过期')
      return { ok: false }
    }
    return { ok: true, url: res.url || callbackUrl }
  }

  return {
    email,
    setEmail,
    code,
    setCode,
    loading,
    hint,
    setHint,
    error,
    setError,
    cooldown,
    canSendCode,
    sendLabel,
    requestCode,
    verifyCode,
  }
}
