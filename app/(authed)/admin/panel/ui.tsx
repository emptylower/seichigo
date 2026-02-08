'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import Button from '@/components/shared/Button'
import { AdminSkeleton } from '@/components/admin/state/AdminSkeleton'
import { AdminErrorState } from '@/components/admin/state/AdminErrorState'
import { AdminEmptyState } from '@/components/admin/state/AdminEmptyState'

type Tab = 'in_review' | 'published'

type QueueItem = {
  id: string
  kind: 'article' | 'revision'
  articleId: string | null
  title: string
  slug: string | null
  status: string
  updatedAt: string
}

type QueueResponse = {
  ok: true
  items: QueueItem[]
  total: number
  page: number
  pageSize: number
} | { error: string }

function formatDate(value: string): string {
  const ms = Date.parse(value)
  if (!Number.isFinite(ms)) return value
  return new Date(ms).toLocaleString('zh-CN')
}

export default function AdminPanelClient() {
  const [tab, setTab] = useState<Tab>('in_review')
  const [items, setItems] = useState<QueueItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [pageSize] = useState(20)
  const [total, setTotal] = useState(0)

  const load = useCallback(async (nextTab = tab, nextPage = page) => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({
        status: nextTab,
        page: String(nextPage),
        pageSize: String(pageSize),
      })
      const res = await fetch(`/api/admin/review/queue?${params.toString()}`, { method: 'GET' })
      const data = (await res.json().catch(() => ({}))) as QueueResponse
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
  }, [page, pageSize, tab])

  useEffect(() => {
    void load(tab, page)
  }, [load, page, tab])

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">管理员面板</h1>
        <p className="mt-1 text-sm text-gray-600">聚焦内容审核与已发布内容管理。</p>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Button
          variant={tab === 'in_review' ? 'primary' : 'ghost'}
          type="button"
          onClick={() => {
            setTab('in_review')
            setPage(1)
          }}
          disabled={loading}
        >
          待审
        </Button>
        <Button
          variant={tab === 'published' ? 'primary' : 'ghost'}
          type="button"
          onClick={() => {
            setTab('published')
            setPage(1)
          }}
          disabled={loading}
        >
          已发布
        </Button>
        <Button variant="ghost" type="button" onClick={() => void load(tab, page)} disabled={loading}>
          刷新
        </Button>
        <Link href="/admin/panel/anime">
          <Button variant="ghost" type="button">作品管理</Button>
        </Link>
        <Link href="/admin/panel/city">
          <Button variant="ghost" type="button">城市管理</Button>
        </Link>
        <Link href="/admin/maintenance">
          <Button variant="ghost" type="button">维护工具</Button>
        </Link>
        <Link href="/admin/waitlist">
          <Button variant="ghost" type="button">Waitlist</Button>
        </Link>
      </div>

      <div className="text-xs text-gray-500">
        共 {total} 条，当前第 {page} / {totalPages} 页
      </div>

      {loading ? <AdminSkeleton rows={8} /> : null}
      {!loading && error ? <AdminErrorState message={error} onRetry={() => void load(tab, page)} /> : null}

      {!loading && !error ? (
        items.length ? (
          <ul className="space-y-3">
            {items.map((item) => (
              <li key={`${item.kind}-${item.id}`} className="rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
                        {item.kind === 'revision' ? '修订' : '文章'}
                      </span>
                      <Link
                        href={tab === 'published' ? `/admin/panel/articles/${item.id}` : `/admin/review/${item.id}`}
                        className="truncate text-sm font-semibold text-gray-900 hover:underline"
                      >
                        {item.title}
                      </Link>
                    </div>
                    <div className="mt-1 text-xs text-gray-500">
                      {item.slug ? `slug: ${item.slug} · ` : ''}
                      更新于 {formatDate(item.updatedAt)}
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <AdminEmptyState title="暂无内容" description="当前筛选条件下没有可展示条目。" />
        )
      ) : null}

      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          disabled={loading || page <= 1}
          onClick={() => setPage((prev) => Math.max(1, prev - 1))}
        >
          上一页
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={loading || page >= totalPages}
          onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
        >
          下一页
        </Button>
      </div>
    </div>
  )
}
