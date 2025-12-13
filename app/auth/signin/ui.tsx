"use client"

import { useSearchParams } from 'next/navigation'
import { signIn } from 'next-auth/react'
import { useState } from 'react'
import Button from '@/components/shared/Button'

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

  const [emailLoginEmail, setEmailLoginEmail] = useState('')
  const [adminEmail, setAdminEmail] = useState('')
  const [adminPassword, setAdminPassword] = useState('')
  const [loading, setLoading] = useState<'email' | 'admin' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [emailSent, setEmailSent] = useState<string | null>(null)

  async function onEmailSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setEmailSent(null)
    setLoading('email')
    const res = (await signIn('email', {
      email: emailLoginEmail,
      redirect: false,
      callbackUrl,
    })) as SignInResult | undefined
    setLoading(null)
    if (!res) {
      setError('发送失败，请稍后重试')
      return
    }
    if (res.error) {
      setError('发送失败，请检查邮箱后重试')
      return
    }
    setEmailSent('登录链接已发送（开发环境可能会在服务端控制台输出链接）。')
  }

  async function onAdminSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setEmailSent(null)
    setLoading('admin')
    const res = (await signIn('credentials', {
      email: adminEmail,
      password: adminPassword,
      redirect: false,
      callbackUrl,
    })) as SignInResult | undefined
    setLoading(null)
    if (!res) {
      setError('登录失败，请稍后重试')
      return
    }
    if (res.error) {
      setError('邮箱或密码不正确（仅管理员可用）')
      return
    }
    window.location.href = res.url || callbackUrl
  }

  return (
    <div className="mx-auto max-w-md px-4 py-12">
      <h1 className="text-2xl font-bold">登录</h1>
      <p className="mt-2 text-sm text-gray-600">使用邮箱登录以进行投稿与创作；管理员可使用帐密登录进入审核流程。</p>

      <section className="mt-8 space-y-2">
        <h2 className="text-lg font-semibold">邮箱登录</h2>
        <form aria-label="邮箱登录表单" onSubmit={onEmailSubmit} className="space-y-4">
          <div>
            <label htmlFor="email-login-email" className="block text-sm font-medium">
              邮箱
            </label>
            <input
              id="email-login-email"
              className="mt-1 w-full rounded-md border px-3 py-2"
              type="email"
              value={emailLoginEmail}
              onChange={(e) => setEmailLoginEmail(e.target.value)}
              autoComplete="email"
              required
            />
          </div>
          {emailSent ? <div className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-700">{emailSent}</div> : null}
          <Button type="submit" disabled={loading === 'email'}>
            {loading === 'email' ? '发送中…' : '发送登录链接'}
          </Button>
        </form>
      </section>

      <section className="mt-10 space-y-2">
        <h2 className="text-lg font-semibold">管理员登录</h2>
        <p className="text-sm text-gray-600">
          仅支持 <code>ADMIN_EMAILS</code> 中配置的邮箱。首次登录默认密码为 <code>112233</code>，登录后将强制修改。
        </p>
        <form aria-label="管理员登录表单" onSubmit={onAdminSubmit} className="mt-4 space-y-4">
        <div>
          <label htmlFor="admin-email" className="block text-sm font-medium">
            邮箱
          </label>
          <input
            id="admin-email"
            className="mt-1 w-full rounded-md border px-3 py-2"
            type="email"
            value={adminEmail}
            onChange={(e) => setAdminEmail(e.target.value)}
            autoComplete="email"
            required
          />
        </div>
        <div>
          <label htmlFor="admin-password" className="block text-sm font-medium">
            密码
          </label>
          <input
            id="admin-password"
            className="mt-1 w-full rounded-md border px-3 py-2"
            type="password"
            value={adminPassword}
            onChange={(e) => setAdminPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </div>
        {errorParam && !error ? (
          <div className="rounded-md bg-rose-50 p-3 text-sm text-rose-700">
            登录失败（{errorParam}）
          </div>
        ) : null}
        {error ? <div className="rounded-md bg-rose-50 p-3 text-sm text-rose-700">{error}</div> : null}
        <Button type="submit" disabled={loading === 'admin'}>
          {loading === 'admin' ? '登录中…' : '登录'}
        </Button>
        </form>
      </section>
    </div>
  )
}
