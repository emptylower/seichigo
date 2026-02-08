"use client"

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import Button from '@/components/shared/Button'
import { useAdminToast } from '@/hooks/useAdminToast'
import { useAdminConfirm } from '@/hooks/useAdminConfirm'
import { AdminSkeleton } from '@/components/admin/state/AdminSkeleton'
import { AdminErrorState } from '@/components/admin/state/AdminErrorState'

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

type ResultTone = 'success' | 'error' | 'info'

type ActionResult = {
  tone: ResultTone
  title: string
  detail: string
  at: string
}

function nowText(): string {
  return new Date().toLocaleString('zh-CN')
}

export default function AdminPanelArticleClient({ id }: { id: string }) {
  const toast = useAdminToast()
  const askForConfirm = useAdminConfirm()
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
  const [actionResult, setActionResult] = useState<ActionResult | null>(null)

  const isInReview = article?.status === 'in_review'
  const isPublished = article?.status === 'published'
  const previewHtml = useMemo(() => article?.contentHtml || '', [article?.contentHtml])

  function setResult(tone: ResultTone, title: string, detailText: string) {
    setActionResult({
      tone,
      title,
      detail: detailText,
      at: nowText(),
    })
  }

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
    if (!article) return

    const accepted = await askForConfirm({
      title: '确认通过文章审核',
      description: '通过后文章将进入已发布状态。',
      confirmLabel: '确认通过',
      cancelLabel: '取消',
      tone: 'danger',
    })
    if (!accepted) return

    setActionError(null)
    setActionSuccess(null)
    setActionLoading('approve')
    const res = await fetch(`/api/admin/review/articles/${id}/approve`, { method: 'POST' })
    const data = (await res.json().catch(() => ({}))) as ActionApiResponse
    setActionLoading(null)
    if (!res.ok || 'error' in data) {
      const msg = ('error' in data && data.error) || '操作失败'
      setActionError(msg)
      setResult('error', '发布失败', msg)
      toast.error(msg)
      return
    }
    setActionSuccess('已同意发布。')
    setResult('success', '发布成功', `文章「${article.title}」已发布`)
    toast.success('已同意发布。')
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
      setResult('error', '拒绝失败', '请先填写拒绝原因')
      return
    }

    const accepted = await askForConfirm({
      title: '确认拒绝文章',
      description: `拒绝原因：${cleaned}`,
      confirmLabel: '确认拒绝',
      cancelLabel: '取消',
      tone: 'danger',
    })
    if (!accepted) return

    setActionLoading('reject')
    const res = await fetch(`/api/admin/review/articles/${id}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: cleaned }),
    })
    const data = (await res.json().catch(() => ({}))) as ActionApiResponse
    setActionLoading(null)
    if (!res.ok || 'error' in data) {
      const msg = ('error' in data && data.error) || '操作失败'
      setActionError(msg)
      setResult('error', '拒绝失败', msg)
      toast.error(msg)
      return
    }
    setActionSuccess('已拒绝。')
    setResult('success', '拒绝成功', `拒绝原因：${cleaned}`)
    toast.success('已拒绝。')
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
      setResult('error', '下架失败', '请先填写下架原因')
      return
    }

    const accepted = await askForConfirm({
      title: '确认下架文章',
      description: `下架原因：${cleaned}`,
      confirmLabel: '确认下架',
      cancelLabel: '取消',
      tone: 'danger',
    })
    if (!accepted) return

    setActionLoading('unpublish')
    const res = await fetch(`/api/admin/review/articles/${id}/unpublish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: cleaned }),
    })
    const data = (await res.json().catch(() => ({}))) as ActionApiResponse
    setActionLoading(null)
    if (!res.ok || 'error' in data) {
      const msg = ('error' in data && data.error) || '操作失败'
      setActionError(msg)
      setResult('error', '下架失败', msg)
      toast.error(msg)
      return
    }
    setActionSuccess('已下架。')
    setResult('success', '下架成功', `下架原因：${cleaned}`)
    toast.success('已下架。')
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
      const msg = data?.error || '保存失败'
      setSlugError(msg)
      toast.error(msg)
      return
    }
    const nextSlug = String(data.article?.slug || cleaned)
    setSlugDraft(nextSlug)
    setArticle((prev) => (prev ? { ...prev, slug: nextSlug } : prev))
    setSlugSuccess('已更新 slug。')
    setResult('success', 'slug 更新成功', `新 slug：${nextSlug}`)
    toast.success('已更新 slug。')
  }

  if (loading) return <AdminSkeleton rows={10} />
  if (error) return <AdminErrorState message={error} onRetry={() => void load()} />

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold">{article?.title || '文章管理'}</h1>
            <p className="mt-1 text-sm text-gray-600">
              <Link href="/admin/panel" className="hover:underline">
                返回管理员面板
              </Link>
            </p>
            <div className="mt-2 text-xs text-gray-500">
              <span className="mr-3">状态：{article?.status}</span>
              {article?.publishedAt ? <span>发布时间：{new Date(article.publishedAt).toLocaleString('zh-CN')}</span> : null}
            </div>
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
      </section>

      <section className="rounded-xl border border-gray-200 bg-gray-50 p-4">
        <h2 className="text-sm font-semibold text-gray-900">结果反馈</h2>
        {actionResult ? (
          <div className="mt-2 space-y-1">
            <div className={actionResult.tone === 'error' ? 'text-sm font-medium text-rose-700' : 'text-sm font-medium text-emerald-700'}>
              {actionResult.title}
            </div>
            <div className="text-sm text-gray-700">{actionResult.detail}</div>
            <div className="text-xs text-gray-500">时间：{actionResult.at}</div>
          </div>
        ) : (
          <p className="mt-2 text-sm text-gray-600">执行发布/拒绝/下架后，会在这里显示结果摘要。</p>
        )}
        {actionError ? <div className="mt-2 rounded-md bg-rose-50 p-3 text-rose-700">{actionError}</div> : null}
        {actionSuccess ? <div className="mt-2 rounded-md bg-emerald-50 p-3 text-emerald-700">{actionSuccess}</div> : null}
      </section>

      {article ? (
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
