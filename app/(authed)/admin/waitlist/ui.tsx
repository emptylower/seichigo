"use client"

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import Button from '@/components/shared/Button'

type WaitlistItem = {
  userId: string
  email: string
  createdAt: string
}

type WaitlistListResponse = { ok: true; items: WaitlistItem[] } | { error: string }

function toTimeMs(value: string | undefined): number {
  const ms = value ? Date.parse(value) : NaN
  return Number.isFinite(ms) ? ms : 0
}

function formatTime(value: string): string {
  const ms = toTimeMs(value)
  if (!ms) return value
  return new Date(ms).toLocaleString()
}

export default function AdminWaitlistClient() {
  const [items, setItems] = useState<WaitlistItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    const res = await fetch('/api/admin/waitlist', { method: 'GET' })
    const data = (await res.json().catch(() => ({}))) as WaitlistListResponse
    if (!res.ok || 'error' in data) {
      setError(('error' in data && data.error) || '加载失败')
      setItems([])
      setLoading(false)
      return
    }
    setItems(data.items || [])
    setLoading(false)
  }

  useEffect(() => {
    void load()
  }, [])

  const sorted = useMemo(() => {
    return [...items].sort((a, b) => toTimeMs(b.createdAt) - toTimeMs(a.createdAt))
  }, [items])

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Waitlist</h1>
          <p className="mt-1 text-sm text-gray-600">App Promo Waitlist 队列（userId + email + createdAt）</p>
        </div>
        <Link href="/admin/panel">
          <Button variant="ghost" type="button">返回面板</Button>
        </Link>
      </div>

      {loading ? <div className="text-gray-600">加载中…</div> : null}
      {error ? <div className="rounded-md bg-rose-50 p-3 text-rose-700">{error}</div> : null}

      {!loading && !error ? (
        <div className="overflow-x-auto rounded-md border border-gray-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-left text-gray-600">
              <tr>
                <th className="px-4 py-2 font-medium">userId</th>
                <th className="px-4 py-2 font-medium">email</th>
                <th className="px-4 py-2 font-medium">createdAt</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((x) => (
                <tr key={x.userId} className="border-t border-gray-100">
                  <td className="px-4 py-2 font-mono text-xs text-gray-800">{x.userId}</td>
                  <td className="px-4 py-2 text-gray-800">{x.email}</td>
                  <td className="px-4 py-2 text-gray-600">{formatTime(x.createdAt)}</td>
                </tr>
              ))}
              {!sorted.length ? (
                <tr>
                  <td className="px-4 py-6 text-gray-500" colSpan={3}>
                    暂无记录。
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  )
}
