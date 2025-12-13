"use client"

import { useState } from 'react'
import Button from '@/components/shared/Button'

type User = { id: string; email?: string | null }

export default function NewArticleClient({ user }: { user: User | null }) {
  const [slug, setSlug] = useState('')
  const [title, setTitle] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onCreate(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const res = await fetch('/api/articles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug, title }),
    })
    setLoading(false)
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      setError(j.error || '创建失败')
      return
    }
    const j = await res.json().catch(() => null)
    const id = j?.article?.id
    if (!id) {
      setError('创建失败（响应异常）')
      return
    }
    window.location.href = `/submit/${id}`
  }

  if (!user) {
    return (
      <div className="max-w-2xl space-y-4">
        <h1 className="text-2xl font-bold">新建文章</h1>
        <p className="text-gray-600">请先登录后再进行创作与投稿。</p>
        <a className="btn-primary inline-flex w-fit" href="/auth/signin?callbackUrl=%2Fsubmit%2Fnew">
          去登录
        </a>
      </div>
    )
  }

  return (
    <div className="max-w-2xl space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold">新建文章</h1>
        <p className="text-sm text-gray-600">先创建草稿，再进入编辑器填写作品信息与正文内容。</p>
      </header>

      <form onSubmit={onCreate} className="space-y-4">
        <div>
          <label htmlFor="slug" className="block text-sm font-medium">
            slug（URL）
          </label>
          <input
            id="slug"
            className="mt-1 w-full rounded-md border px-3 py-2"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="my-first-route"
            required
          />
          <p className="mt-1 text-xs text-gray-500">建议使用英文/数字/连字符，且全站唯一。</p>
        </div>

        <div>
          <label htmlFor="title" className="block text-sm font-medium">
            标题
          </label>
          <input
            id="title"
            className="mt-1 w-full rounded-md border px-3 py-2"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="《作品名》一日巡礼路线（示例）"
            required
          />
        </div>

        {error ? <div className="rounded-md bg-rose-50 p-3 text-sm text-rose-700">{error}</div> : null}

        <div className="flex gap-2">
          <Button type="submit" disabled={loading}>
            {loading ? '创建中…' : '创建草稿'}
          </Button>
          <Button type="button" variant="ghost" onClick={() => (window.location.href = '/submit')}>
            返回
          </Button>
        </div>
      </form>
    </div>
  )
}
