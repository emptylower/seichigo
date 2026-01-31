'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

type TranslationTask = {
  id: string
  entityType: string
  entityId: string
  targetLanguage: string
  status: string
  createdAt: string
}

export default function TranslationsUI() {
  const [tasks, setTasks] = useState<TranslationTask[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('ready')

  async function loadTasks() {
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/translations?status=${filter}`)
      const data = await res.json()
      setTasks(data.tasks || [])
    } catch (error) {
      console.error('Failed to load tasks', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadTasks()
  }, [filter])

  const statusLabels: Record<string, string> = {
    pending: '待处理',
    processing: '处理中',
    ready: '待审核',
    approved: '已确认',
    failed: '失败',
  }

  const entityTypeLabels: Record<string, string> = {
    article: '文章',
    city: '城市',
    anime: '动漫',
  }

  const languageLabels: Record<string, string> = {
    en: 'English',
    ja: '日本語',
  }

  if (loading) {
    return <div className="text-gray-600">加载中...</div>
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <label className="text-sm font-medium">状态筛选:</label>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="rounded-md border px-3 py-2 text-sm"
        >
          <option value="pending">待处理</option>
          <option value="processing">处理中</option>
          <option value="ready">待审核</option>
          <option value="approved">已确认</option>
          <option value="failed">失败</option>
        </select>
      </div>

      {tasks.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-8 text-center text-gray-600">
          暂无翻译任务
        </div>
      ) : (
        <div className="space-y-3">
          {tasks.map((task) => (
            <div
              key={task.id}
              className="rounded-lg border border-gray-200 bg-white p-4 hover:border-brand-300 transition-colors"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="rounded bg-blue-100 px-2 py-1 text-xs font-medium text-blue-700">
                    {entityTypeLabels[task.entityType] || task.entityType}
                  </span>
                  <span className="text-sm text-gray-600">→</span>
                  <span className="rounded bg-purple-100 px-2 py-1 text-xs font-medium text-purple-700">
                    {languageLabels[task.targetLanguage] || task.targetLanguage}
                  </span>
                  <span className="rounded bg-amber-100 px-2 py-1 text-xs font-medium text-amber-700">
                    {statusLabels[task.status] || task.status}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500">
                    {new Date(task.createdAt).toLocaleDateString('zh-CN')}
                  </span>
                  <Link
                    href={`/admin/translations/${task.id}`}
                    className="rounded-md bg-brand-500 px-3 py-1 text-sm text-white hover:bg-brand-600"
                  >
                    查看
                  </Link>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
