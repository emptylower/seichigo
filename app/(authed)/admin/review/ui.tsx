'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import Button from '@/components/shared/Button'
import { AdminSkeleton } from '@/components/admin/state/AdminSkeleton'
import { AdminErrorState } from '@/components/admin/state/AdminErrorState'
import { AdminEmptyState } from '@/components/admin/state/AdminEmptyState'
import { useAdminToast } from '@/hooks/useAdminToast'

type ReviewStatus = 'in_review' | 'published'

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

export default function AdminReviewListClient() {
  const toast = useAdminToast()
  const [status, setStatus] = useState<ReviewStatus>('in_review')
  const [items, setItems] = useState<QueueItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [pageSize] = useState(20)
  const [total, setTotal] = useState(0)

  const load = useCallback(async (nextStatus = status, nextPage = page) => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({
        status: nextStatus,
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
  }, [page, pageSize, status])

  useEffect(() => {
    void load(status, page)
  }, [load, page, status])

  useEffect(() => {
    try {
      const msg = window.sessionStorage?.getItem('seichigo.adminReview.flash') || ''
      if (!msg) return
      window.sessionStorage?.removeItem('seichigo.adminReview.flash')
      toast.success(msg)
    } catch {
      // ignore
    }
  }, [toast])

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">审核队列</h1>
          <p className="mt-1 text-sm text-gray-600">集中处理文章发布与修订审核。</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={status === 'in_review' ? 'primary' : 'ghost'}
            type="button"
            onClick={() => {
              setStatus('in_review')
              setPage(1)
            }}
            disabled={loading}
          >
            待审核
          </Button>
          <Button
            variant={status === 'published' ? 'primary' : 'ghost'}
            type="button"
            onClick={() => {
              setStatus('published')
              setPage(1)
            }}
            disabled={loading}
          >
            已发布
          </Button>
          <Button variant="ghost" type="button" onClick={() => void load(status, page)} disabled={loading}>
            刷新
          </Button>
        </div>
      </div>

      <div className="text-xs text-gray-500">
        共 {total} 条，当前第 {page} / {totalPages} 页
      </div>

      {loading ? <AdminSkeleton rows={8} /> : null}
      {!loading && error ? <AdminErrorState message={error} onRetry={() => void load(status, page)} /> : null}

      {!loading && !error ? (
        items.length === 0 ? (
          <AdminEmptyState
            title={status === 'in_review' ? '暂无待审核内容' : '暂无已发布内容'}
            description={status === 'in_review' ? '当前没有需要你处理的条目。' : '暂时没有已发布记录。'}
          />
        ) : (
          <ul className="space-y-3">
            {items.map((item) => (
              <li key={`${item.kind}-${item.id}`} className="rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
                        {item.kind === 'revision' ? '修订' : '文章'}
                      </span>
                      <Link href={`/admin/review/${item.id}`} className="truncate text-sm font-semibold text-gray-900 hover:underline">
                        {item.title}
                      </Link>
                    </div>
                    <div className="mt-1 text-xs text-gray-500">
                      {item.slug ? `slug: ${item.slug} · ` : ''}
                      更新于 {formatDate(item.updatedAt)}
                    </div>
                  </div>
                  <Link href={`/admin/review/${item.id}`}>
                    <Button variant="ghost" type="button">查看</Button>
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )
      ) : null}

      <div className="flex items-center justify-end gap-2">
        <Button
          variant="ghost"
          type="button"
          disabled={loading || page <= 1}
          onClick={() => setPage((prev) => Math.max(1, prev - 1))}
        >
          上一页
        </Button>
        <Button
          variant="ghost"
          type="button"
          disabled={loading || page >= totalPages}
          onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
        >
          下一页
        </Button>
      </div>
    </div>
  )
}
