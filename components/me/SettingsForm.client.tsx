'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import CoverField from '@/components/shared/CoverField'
import type { ProfileData } from '@/lib/profile/types'

type SettingsFormProps = {
  initialData: ProfileData
}

export default function SettingsForm({ initialData }: SettingsFormProps) {
  const router = useRouter()
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

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || '保存失败')
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

      <form onSubmit={handleSubmit} className="space-y-6 bg-white p-6 rounded-lg border shadow-sm">
        <div>
          <CoverField
            value={formData.image || ''}
            onChange={(url) => setFormData({ ...formData, image: url })}
            aspectRatio={1}
            label="头像"
            description="建议上传正方形图片，支持裁剪"
          />
        </div>

        <div>
          <label htmlFor="name" className="block text-sm font-medium mb-2 text-gray-700">
            昵称
          </label>
          <input
            id="name"
            type="text"
            value={formData.name || ''}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-shadow"
            placeholder="请输入昵称"
          />
        </div>

        <div>
          <label htmlFor="bio" className="block text-sm font-medium mb-2 text-gray-700">
            简介 <span className="text-gray-400 font-normal">(最多500字)</span>
          </label>
          <textarea
            id="bio"
            value={formData.bio || ''}
            onChange={(e) => setFormData({ ...formData, bio: e.target.value })}
            maxLength={500}
            rows={4}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-shadow resize-none"
            placeholder="介绍一下你自己..."
          />
          <div className="flex justify-end mt-1">
            <span className="text-xs text-gray-400">
              {formData.bio?.length || 0} / 500
            </span>
          </div>
        </div>

        <div className="space-y-4 pt-4 border-t border-gray-100">
          <h3 className="text-lg font-medium text-gray-900">社交账号</h3>
          
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label htmlFor="bilibili" className="block text-sm font-medium mb-2 text-gray-700">
                B站
              </label>
              <input
                id="bilibili"
                type="text"
                value={formData.bilibili || ''}
                onChange={(e) => setFormData({ ...formData, bilibili: e.target.value })}
                placeholder="https://space.bilibili.com/..."
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
              />
            </div>

            <div>
              <label htmlFor="weibo" className="block text-sm font-medium mb-2 text-gray-700">
                微博
              </label>
              <input
                id="weibo"
                type="text"
                value={formData.weibo || ''}
                onChange={(e) => setFormData({ ...formData, weibo: e.target.value })}
                placeholder="https://weibo.com/..."
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
              />
            </div>

            <div>
              <label htmlFor="github" className="block text-sm font-medium mb-2 text-gray-700">
                GitHub
              </label>
              <input
                id="github"
                type="text"
                value={formData.github || ''}
                onChange={(e) => setFormData({ ...formData, github: e.target.value })}
                placeholder="https://github.com/..."
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
              />
            </div>

            <div>
              <label htmlFor="twitter" className="block text-sm font-medium mb-2 text-gray-700">
                Twitter
              </label>
              <input
                id="twitter"
                type="text"
                value={formData.twitter || ''}
                onChange={(e) => setFormData({ ...formData, twitter: e.target.value })}
                placeholder="https://twitter.com/..."
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
              />
            </div>
          </div>
        </div>

        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-md text-red-700 text-sm">
            {error}
          </div>
        )}

        <div className="pt-4">
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full px-4 py-2.5 bg-brand-500 text-white font-medium rounded-md hover:bg-brand-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isSubmitting ? '保存中...' : '保存更改'}
          </button>
        </div>
      </form>
    </div>
  )
}
