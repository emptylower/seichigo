'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import CoverField from '@/components/shared/CoverField'
import type { ProfileData } from '@/lib/profile/types'

type SettingsFormProps = {
  initialData: ProfileData
}

export default function SettingsForm({ initialData }: SettingsFormProps) {
  const router = useRouter()
  const { update } = useSession()
  const [formData, setFormData] = useState<ProfileData>(initialData)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showToast, setShowToast] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    setError(null)
    setShowToast(false)

    try {
      const res = await fetch('/api/me/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      })

      const data = (await res.json().catch(() => null)) as (ProfileData & { error?: string }) | null

      if (!res.ok) {
        throw new Error(data?.error || '保存失败')
      }

      if (data) {
        setFormData(data)
      }
      try {
        await update()
      } catch {
        // Ignore session refresh errors; profile save already succeeded.
      }
      setShowToast(true)
      setTimeout(() => setShowToast(false), 3000)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="relative">
      {showToast && (
        <div className="fixed top-4 right-4 z-50 animate-in slide-in-from-top-2 fade-in">
          <div className="rounded-lg bg-emerald-500 px-4 py-3 text-white shadow-lg">
            <div className="flex items-center gap-2">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span className="font-medium">保存成功！</span>
            </div>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="rounded-2xl border border-pink-100 bg-white/90 p-4 text-sm text-slate-600 shadow-sm sm:p-5">
          导航栏头像与昵称会同步使用这里的资料。
        </div>

        <section className="space-y-5 rounded-3xl border border-pink-100/90 bg-white/90 p-5 shadow-sm sm:p-6">
          <h3 className="text-base font-semibold text-slate-900">基础信息</h3>
          <CoverField
            value={formData.image || ''}
            onChange={(url) => setFormData({ ...formData, image: url })}
            aspectRatio={1}
            label="头像"
            description="建议上传正方形图片，支持裁剪"
          />

          <div>
            <label htmlFor="name" className="mb-2 block text-sm font-medium text-gray-700">
              昵称
            </label>
            <input
              id="name"
              type="text"
              value={formData.name || ''}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 transition-shadow focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
              placeholder="请输入昵称"
            />
          </div>

          <div>
            <label htmlFor="bio" className="mb-2 block text-sm font-medium text-gray-700">
              简介 <span className="font-normal text-gray-400">(最多500字)</span>
            </label>
            <textarea
              id="bio"
              value={formData.bio || ''}
              onChange={(e) => setFormData({ ...formData, bio: e.target.value })}
              maxLength={500}
              rows={4}
              className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 transition-shadow focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 resize-none"
              placeholder="介绍一下你自己..."
            />
            <div className="mt-1 flex justify-end">
              <span className="text-xs text-gray-400">
                {formData.bio?.length || 0} / 500
              </span>
            </div>
          </div>
        </section>

        <section className="space-y-4 rounded-3xl border border-pink-100/90 bg-white/90 p-5 shadow-sm sm:p-6">
          <h3 className="text-base font-semibold text-slate-900">社交账号</h3>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label htmlFor="bilibili" className="mb-2 block text-sm font-medium text-gray-700">
                B站
              </label>
              <input
                id="bilibili"
                type="text"
                value={formData.bilibili || ''}
                onChange={(e) => setFormData({ ...formData, bilibili: e.target.value })}
                placeholder="https://space.bilibili.com/..."
                className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
              />
            </div>

            <div>
              <label htmlFor="weibo" className="mb-2 block text-sm font-medium text-gray-700">
                微博
              </label>
              <input
                id="weibo"
                type="text"
                value={formData.weibo || ''}
                onChange={(e) => setFormData({ ...formData, weibo: e.target.value })}
                placeholder="https://weibo.com/..."
                className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
              />
            </div>

            <div>
              <label htmlFor="github" className="mb-2 block text-sm font-medium text-gray-700">
                GitHub
              </label>
              <input
                id="github"
                type="text"
                value={formData.github || ''}
                onChange={(e) => setFormData({ ...formData, github: e.target.value })}
                placeholder="https://github.com/..."
                className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
              />
            </div>

            <div>
              <label htmlFor="twitter" className="mb-2 block text-sm font-medium text-gray-700">
                Twitter
              </label>
              <input
                id="twitter"
                type="text"
                value={formData.twitter || ''}
                onChange={(e) => setFormData({ ...formData, twitter: e.target.value })}
                placeholder="https://twitter.com/..."
                className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
              />
            </div>
          </div>
        </section>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="rounded-2xl border border-pink-100 bg-white/90 p-3 shadow-sm sm:p-4">
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-xl bg-brand-500 px-4 py-2.5 font-medium text-white transition-colors hover:bg-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSubmitting ? '保存中...' : '保存更改'}
          </button>
        </div>
      </form>
    </div>
  )
}
