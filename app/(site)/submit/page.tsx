"use client"
import { useState } from 'react'
import Button from '@/components/shared/Button'
import { z } from 'zod'

const schema = z.object({
  animeName: z.string().min(1, '请填写作品名'),
  city: z.string().min(1, '请填写城市'),
  title: z.string().min(5, '标题至少 5 个字'),
  contentMarkdown: z.string().min(100, '正文至少 100 字'),
  references: z.string().optional(),
})

export default function SubmitPage() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setSuccess(null)
    const form = new FormData(e.currentTarget)
    const data = Object.fromEntries(form) as any
    const parsed = schema.safeParse(data)
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message || '表单有误')
      return
    }
    setLoading(true)
    const res = await fetch('/api/submissions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parsed.data),
    })
    setLoading(false)
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      setError(j.error || '提交失败，请稍后再试')
    } else {
      setSuccess('提交成功！我们会尽快审核。')
      ;(e.target as HTMLFormElement).reset()
    }
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold">投稿</h1>
      <p className="mt-2 text-gray-600">登录后可提交你的巡礼线路与心得。我们会进行编辑加工，不保证所有投稿都会发布。</p>
      <div className="mt-6" />
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium">作品名</label>
          <input name="animeName" className="mt-1 w-full rounded-md border px-3 py-2" required />
        </div>
        <div>
          <label className="block text-sm font-medium">城市</label>
          <input name="city" className="mt-1 w-full rounded-md border px-3 py-2" required />
        </div>
        <div>
          <label className="block text-sm font-medium">标题建议</label>
          <input name="title" className="mt-1 w-full rounded-md border px-3 py-2" required />
        </div>
        <div>
          <label className="block text-sm font-medium">正文（Markdown）</label>
          <textarea name="contentMarkdown" className="mt-1 h-52 w-full rounded-md border px-3 py-2" required />
        </div>
        <div>
          <label className="block text-sm font-medium">参考链接（可多条，换行分隔）</label>
          <textarea name="references" className="mt-1 h-24 w-full rounded-md border px-3 py-2" />
        </div>
        <div className="text-sm text-gray-500">未登录的用户将被要求先登录（Email 验证）。</div>
        {error && <div className="rounded-md bg-rose-50 p-3 text-rose-700">{error}</div>}
        {success && <div className="rounded-md bg-emerald-50 p-3 text-emerald-700">{success}</div>}
        <Button type="submit" disabled={loading}>{loading ? '提交中…' : '提交'}</Button>
      </form>
    </div>
  )
}

