'use client'

import { useCallback, useEffect, useState } from 'react'
import Button from '@/components/shared/Button'
import { AdminEmptyState } from '@/components/admin/state/AdminEmptyState'
import { AdminErrorState } from '@/components/admin/state/AdminErrorState'
import { AdminSkeleton } from '@/components/admin/state/AdminSkeleton'
import { useAdminConfirm } from '@/hooks/useAdminConfirm'
import { useAdminToast } from '@/hooks/useAdminToast'
import { COMMENT_REPORT_REASON_LABELS } from '@/lib/comment/reasons'

type ModeratedReport = {
  id: string
  reporterId: string
  reason: string
  createdAt: string
}

type ModeratedComment = {
  id: string
  articleId: string | null
  mdxSlug: string | null
  authorId: string
  content: string
  status: 'visible' | 'hidden'
  hiddenAt: string | null
  hiddenBy: string | null
  createdAt: string
  reports: ModeratedReport[]
}

type ListResponse = { ok: true; comments: ModeratedComment[] } | { error: string }

function formatDate(value: string | null): string {
  if (!value) return '-'
  const time = Date.parse(value)
  return Number.isFinite(time) ? new Date(time).toLocaleString('zh-CN') : value
}

function reportLabel(reason: string): string {
  return reason in COMMENT_REPORT_REASON_LABELS
    ? COMMENT_REPORT_REASON_LABELS[reason as keyof typeof COMMENT_REPORT_REASON_LABELS]
    : reason
}

export default function CommentsAdminUI() {
  const toast = useAdminToast()
  const askForConfirm = useAdminConfirm()
  const [comments, setComments] = useState<ModeratedComment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/comments', { method: 'GET' })
      const data = (await res.json().catch(() => ({}))) as ListResponse
      if (!res.ok || 'error' in data) throw new Error('error' in data ? data.error : '加载评论失败')
      setComments(data.comments || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载评论失败')
      setComments([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function updateStatus(commentId: string, action: 'hide' | 'restore') {
    setBusyId(commentId)
    try {
      const res = await fetch(`/api/admin/comments/${encodeURIComponent(commentId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(data.error || '更新评论状态失败')
      toast.success(action === 'hide' ? '评论已隐藏' : '评论已恢复')
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '更新评论状态失败')
    } finally {
      setBusyId(null)
    }
  }

  async function remove(commentId: string) {
    const confirmed = await askForConfirm({
      title: '删除评论',
      description: '删除后评论、回复、点赞和举报记录都会被移除，无法恢复。',
      confirmLabel: '确认删除',
      tone: 'danger',
    })
    if (!confirmed) return

    setBusyId(commentId)
    try {
      const res = await fetch(`/api/admin/comments/${encodeURIComponent(commentId)}`, { method: 'DELETE' })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(data.error || '删除评论失败')
      toast.success('评论已删除')
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除评论失败')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">评论治理</h1>
          <p className="mt-1 text-sm text-gray-600">查看评论举报并处理公开状态。</p>
        </div>
        <Button type="button" variant="ghost" onClick={() => void load()} disabled={loading}>
          刷新
        </Button>
      </div>

      {loading ? <AdminSkeleton rows={6} /> : null}
      {!loading && error ? <AdminErrorState message={error} onRetry={() => void load()} /> : null}
      {!loading && !error && comments.length === 0 ? (
        <AdminEmptyState title="暂无评论" description="目前没有可治理的评论记录。" />
      ) : null}

      {!loading && !error && comments.length > 0 ? (
        <div className="space-y-3">
          {comments.map((comment) => {
            const busy = busyId === comment.id
            return (
              <article key={comment.id} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className={comment.status === 'visible' ? 'rounded bg-green-50 px-2 py-0.5 text-green-700' : 'rounded bg-amber-50 px-2 py-0.5 text-amber-700'}>
                        {comment.status === 'visible' ? '公开' : '已隐藏'}
                      </span>
                      <span className="text-gray-500">作者：{comment.authorId}</span>
                      <time className="text-gray-400" dateTime={comment.createdAt}>{formatDate(comment.createdAt)}</time>
                    </div>
                    <p className="mt-1 break-all text-xs text-gray-500">
                      {comment.articleId ? `文章 ${comment.articleId}` : `MDX ${comment.mdxSlug || '-'}`}
                      {comment.hiddenBy ? ` · 操作者 ${comment.hiddenBy}` : ''}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button type="button" variant="ghost" disabled={busy} onClick={() => void updateStatus(comment.id, comment.status === 'visible' ? 'hide' : 'restore')}>
                      {comment.status === 'visible' ? '隐藏' : '恢复'}
                    </Button>
                    <Button type="button" variant="ghost" disabled={busy} className="text-red-600 hover:bg-red-50" onClick={() => void remove(comment.id)}>
                      删除
                    </Button>
                  </div>
                </div>

                <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-gray-800">{comment.content}</p>

                <div className="mt-4 border-t border-gray-100 pt-3">
                  <div className="text-sm font-medium text-gray-700">举报记录（{comment.reports.length}）</div>
                  {comment.reports.length === 0 ? (
                    <p className="mt-1 text-sm text-gray-500">暂无举报</p>
                  ) : (
                    <ul className="mt-2 space-y-1 text-sm text-gray-600">
                      {comment.reports.map((report) => (
                        <li key={report.id} className="break-words">
                          {reportLabel(report.reason)} · {report.reporterId} · {formatDate(report.createdAt)}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
