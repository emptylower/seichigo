"use client"

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import Button from '@/components/shared/Button'

type ArticleDetail = {
  id: string
  slug: string
  title: string
  animeIds: string[]
  city: string | null
  routeLength: string | null
  tags: string[]
  contentHtml: string
  status: 'draft' | 'in_review' | 'rejected' | 'published'
  rejectReason: string | null
  publishedAt: string | null
  updatedAt: string
}

type DetailApiResponse =
  | { ok: true; article: ArticleDetail }
  | { error: string }

type ActionApiResponse =
  | { ok: true; article: { id: string; status: string; rejectReason?: string | null; publishedAt?: string | null } }
  | { error: string }

export default function AdminPanelArticleClient({ id }: { id: string }) {
  const [article, setArticle] = useState<ArticleDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [slugDraft, setSlugDraft] = useState('')
  const [slugSaving, setSlugSaving] = useState(false)
  const [slugError, setSlugError] = useState<string | null>(null)
  const [slugSuccess, setSlugSuccess] = useState<string | null>(null)

  const [rejectReason, setRejectReason] = useState('')
  const [unpublishReason, setUnpublishReason] = useState('')
  const [actionLoading, setActionLoading] = useState<'approve' | 'reject' | 'unpublish' | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionSuccess, setActionSuccess] = useState<string | null>(null)

  const isInReview = article?.status === 'in_review'
  const isPublished = article?.status === 'published'
  const previewHtml = useMemo(() => article?.contentHtml || '', [article?.contentHtml])

  async function load() {
    setLoading(true)
    setError(null)
    const res = await fetch(`/api/articles/${id}`, { method: 'GET' })
    const data = (await res.json().catch(() => ({}))) as DetailApiResponse
    if (!res.ok || 'error' in data) {
      setError(('error' in data && data.error) || '加载失败')
      setLoading(false)
      return
    }
    setArticle(data.article)
    setSlugDraft(data.article.slug || '')
    setLoading(false)
  }

  useEffect(() => {
    void load()
  }, [id])

  async function onApprove() {
    setActionError(null)
    setActionSuccess(null)
    setActionLoading('approve')
    const res = await fetch(`/api/admin/review/articles/${id}/approve`, { method: 'POST' })
    const data = (await res.json().catch(() => ({}))) as ActionApiResponse
    setActionLoading(null)
    if (!res.ok || 'error' in data) {
      setActionError(('error' in data && data.error) || '操作失败')
      return
    }
    setActionSuccess('已同意发布。')
    setArticle((prev) =>
      prev
        ? {
            ...prev,
            status: 'published',
            publishedAt: data.article.publishedAt ?? prev.publishedAt,
          }
        : prev
    )
  }

  async function onReject() {
    const cleaned = rejectReason.trim()
    setActionError(null)
    setActionSuccess(null)
    if (!cleaned) {
      setActionError('请填写拒绝原因')
      return
    }
    setActionLoading('reject')
    const res = await fetch(`/api/admin/review/articles/${id}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: cleaned }),
    })
    const data = (await res.json().catch(() => ({}))) as ActionApiResponse
    setActionLoading(null)
    if (!res.ok || 'error' in data) {
      setActionError(('error' in data && data.error) || '操作失败')
      return
    }
    setActionSuccess('已拒绝。')
    setArticle((prev) =>
      prev
        ? {
            ...prev,
            status: 'rejected',
            rejectReason: data.article.rejectReason ?? cleaned,
            publishedAt: null,
          }
        : prev
    )
  }

  async function onUnpublish() {
    const cleaned = unpublishReason.trim()
    setActionError(null)
    setActionSuccess(null)
    if (!cleaned) {
      setActionError('请填写下架原因')
      return
    }
    setActionLoading('unpublish')
    const res = await fetch(`/api/admin/review/articles/${id}/unpublish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: cleaned }),
    })
    const data = (await res.json().catch(() => ({}))) as ActionApiResponse
    setActionLoading(null)
    if (!res.ok || 'error' in data) {
      setActionError(('error' in data && data.error) || '操作失败')
      return
    }
    setActionSuccess('已下架。')
    setArticle((prev) =>
      prev
        ? {
            ...prev,
            status: 'rejected',
            rejectReason: data.article.rejectReason ?? cleaned,
          }
        : prev
    )
  }

  async function onSaveSlug() {
    const cleaned = slugDraft.trim()
    setSlugError(null)
    setSlugSuccess(null)
    if (!cleaned) {
      setSlugError('slug 不能为空')
      return
    }
    setSlugSaving(true)
    const res = await fetch(`/api/admin/review/articles/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: cleaned }),
    })
    const data = (await res.json().catch(() => ({}))) as { ok?: true; article?: { slug?: string }; error?: string }
    setSlugSaving(false)
    if (!res.ok || !data?.ok) {
      setSlugError(data?.error || '保存失败')
      return
    }
    const nextSlug = String(data.article?.slug || cleaned)
    setSlugDraft(nextSlug)
    setArticle((prev) => (prev ? { ...prev, slug: nextSlug } : prev))
    setSlugSuccess('已更新 slug。')
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold">{article?.title || '文章管理'}</h1>
          <p className="mt-1 text-sm text-gray-600">
            <Link href="/admin/panel" className="hover:underline">
              返回管理员面板
            </Link>
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isInReview ? (
            <>
              <Button onClick={onApprove} disabled={actionLoading != null}>
                {actionLoading === 'approve' ? '处理中…' : '同意发布'}
              </Button>
              <Button variant="ghost" onClick={onReject} disabled={actionLoading != null}>
                {actionLoading === 'reject' ? '处理中…' : '拒绝'}
              </Button>
            </>
          ) : null}
          {isPublished ? (
            <Button onClick={onUnpublish} disabled={actionLoading != null}>
              {actionLoading === 'unpublish' ? '处理中…' : '下架'}
            </Button>
          ) : null}
        </div>
      </div>

      {actionError ? <div className="rounded-md bg-rose-50 p-3 text-rose-700">{actionError}</div> : null}
      {actionSuccess ? <div className="rounded-md bg-emerald-50 p-3 text-emerald-700">{actionSuccess}</div> : null}

      {loading ? <div className="text-gray-600">加载中…</div> : null}
      {error ? <div className="rounded-md bg-rose-50 p-3 text-rose-700">{error}</div> : null}

      {article && !loading && !error ? (
        <div className="space-y-6">
          <section className="card space-y-1">
            <div className="space-y-2">
              <label htmlFor="article-slug" className="block text-sm font-medium text-gray-700">
                slug（必填）
              </label>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <input
                  id="article-slug"
                  className="w-full rounded-md border px-3 py-2 text-sm"
                  value={slugDraft}
                  onChange={(e) => setSlugDraft(e.target.value)}
                  placeholder={article.animeIds?.[0] ? `${article.animeIds[0]}-xxx` : 'your-slug'}
                  disabled={slugSaving || actionLoading != null}
                />
                <Button onClick={onSaveSlug} disabled={slugSaving || actionLoading != null}>
                  {slugSaving ? '保存中…' : '保存 slug'}
                </Button>
              </div>
              {article.animeIds?.[0] ? <div className="text-xs text-gray-500">建议格式：{article.animeIds[0]}-xxx（作品前缀 + 文章后缀）</div> : null}
              {slugError ? <div className="rounded-md bg-rose-50 p-3 text-rose-700">{slugError}</div> : null}
              {slugSuccess ? <div className="rounded-md bg-emerald-50 p-3 text-emerald-700">{slugSuccess}</div> : null}
            </div>
            <div className="text-sm text-gray-600">
              <span className="font-medium text-gray-900">状态：</span>
              <span>{article.status}</span>
            </div>
          </section>

          <section className="space-y-2">
            <h2 className="text-xl font-semibold">内容预览</h2>
            {previewHtml ? (
              <div className="prose prose-pink max-w-none" dangerouslySetInnerHTML={{ __html: previewHtml }} />
            ) : (
              <div className="text-gray-500">暂无内容。</div>
            )}
          </section>

          {isInReview ? (
            <section className="space-y-2">
              <h2 className="text-xl font-semibold">拒绝</h2>
              <label htmlFor="reject-reason" className="block text-sm font-medium text-gray-700">
                拒绝原因（必填）
              </label>
              <textarea
                id="reject-reason"
                className="h-28 w-full rounded-md border px-3 py-2"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="请填写拒绝原因（必填）"
                disabled={actionLoading != null}
              />
            </section>
          ) : null}

          {isPublished ? (
            <section className="space-y-2">
              <h2 className="text-xl font-semibold">下架</h2>
              <label htmlFor="unpublish-reason" className="block text-sm font-medium text-gray-700">
                下架原因（必填）
              </label>
              <textarea
                id="unpublish-reason"
                className="h-28 w-full rounded-md border px-3 py-2"
                value={unpublishReason}
                onChange={(e) => setUnpublishReason(e.target.value)}
                placeholder="请填写下架原因（必填）"
                disabled={actionLoading != null}
              />
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
