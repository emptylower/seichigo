"use client"

import { useState } from 'react'
import Button from '@/components/shared/Button'

export default function ChangePasswordForm() {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(null)
    if (newPassword.length < 6) {
      setError('新密码至少 6 位')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('两次输入的新密码不一致')
      return
    }
    setLoading(true)
    const res = await fetch('/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword, newPassword }),
    })
    setLoading(false)
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      setError(j.error || '修改失败')
      return
    }
    setSuccess('密码已更新，正在跳转…')
    window.location.href = '/'
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium">当前密码</label>
        <input
          className="mt-1 w-full rounded-md border px-3 py-2"
          type="password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
      </div>
      <div>
        <label className="block text-sm font-medium">新密码</label>
        <input
          className="mt-1 w-full rounded-md border px-3 py-2"
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          autoComplete="new-password"
          required
        />
      </div>
      <div>
        <label className="block text-sm font-medium">确认新密码</label>
        <input
          className="mt-1 w-full rounded-md border px-3 py-2"
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          autoComplete="new-password"
          required
        />
      </div>
      {error ? <div className="rounded-md bg-rose-50 p-3 text-sm text-rose-700">{error}</div> : null}
      {success ? <div className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-700">{success}</div> : null}
      <Button type="submit" disabled={loading}>
        {loading ? '提交中…' : '修改密码'}
      </Button>
    </form>
  )
}

