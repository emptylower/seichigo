'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Button from '@/components/shared/Button'
import { AdminSkeleton } from '@/components/admin/state/AdminSkeleton'
import { AdminErrorState } from '@/components/admin/state/AdminErrorState'
import { AdminEmptyState } from '@/components/admin/state/AdminEmptyState'

type WaitlistItem = {
  userId: string
  email: string
  createdAt: string
}

type WaitlistListResponse =
  | { ok: true; items: WaitlistItem[]; total: number; page: number; pageSize: number }
  | { error: string }

function toTimeMs(value: string | undefined): number {
  const ms = value ? Date.parse(value) : NaN
  return Number.isFinite(ms) ? ms : 0
}

function formatTime(value: string): string {
  const ms = toTimeMs(value)
  if (!ms) return value
  return new Date(ms).toLocaleString('zh-CN')
}

export default function AdminWaitlistClient() {
  const [items, setItems] = useState<WaitlistItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize] = useState(20)
  const [total, setTotal] = useState(0)

  const load = useCallback(async (query = q, nextPage = page) => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({
        q: query,
        page: String(nextPage),
        pageSize: String(pageSize),
      })
      const res = await fetch(`/api/admin/waitlist?${params.toString()}`, { method: 'GET' })
      const data = (await res.json().catch(() => ({}))) as WaitlistListResponse
      if (!res.ok || 'error' in data) {
        throw new Error('error' in data ? data.error : '加载失败')
      }
      setItems(data.items || [])
      setTotal(data.total || 0)
      setPage(data.page || nextPage)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败')
      setItems([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [page, pageSize, q])

  useEffect(() => {
    void load('', 1)
  }, [load])

  function onSearch(e: React.FormEvent) {
    e.preventDefault()
    void load(q, 1)
  }

  const sorted = useMemo(() => {
    return [...items].sort((a, b) => toTimeMs(b.createdAt) - toTimeMs(a.createdAt))
  }, [items])

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Waitlist</h1>
          <p className="mt-1 text-sm text-gray-600">管理 App Promo Waitlist 队列（userId + email + createdAt）</p>
        </div>
        <Link href="/admin/dashboard">
          <Button variant="ghost" type="button">返回仪表盘</Button>
        </Link>
      </div>

      <form onSubmit={onSearch} className="flex flex-wrap items-center gap-2">
        <input
          className="w-full max-w-xs rounded-md border px-3 py-2 text-sm"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜索 email / userId"
        />
        <Button type="submit" disabled={loading}>搜索</Button>
        <Button type="button" variant="ghost" disabled={loading} onClick={() => void load(q, page)}>
          刷新
        </Button>
      </form>

      <div className="text-xs text-gray-500">
        共 {total} 条，当前第 {page} / {totalPages} 页
      </div>

      {loading ? <AdminSkeleton rows={8} /> : null}
      {!loading && error ? <AdminErrorState message={error} onRetry={() => void load(q, page)} /> : null}

      {!loading && !error ? (
        sorted.length ? (
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
              </tbody>
            </table>
          </div>
        ) : (
          <AdminEmptyState title="暂无记录" description="当前筛选条件下没有 Waitlist 数据。" />
        )
      ) : null}

      <div className="flex items-center justify-end gap-2">
        <Button
          variant="ghost"
          type="button"
          disabled={loading || page <= 1}
          onClick={() => void load(q, page - 1)}
        >
          上一页
        </Button>
        <Button
          variant="ghost"
          type="button"
          disabled={loading || page >= totalPages}
          onClick={() => void load(q, page + 1)}
        >
          下一页
        </Button>
      </div>
    </div>
  )
}
