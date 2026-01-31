'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import TipTapPreview from '@/components/translation/TipTapPreview'

type TranslationTask = {
  id: string
  entityType: string
  entityId: string
  targetLanguage: string
  status: string
  sourceContent: any
  draftContent: any
  error?: string
  createdAt: string
}

type Props = {
  id: string
}

export default function TranslationDetailUI({ id }: Props) {
  const router = useRouter()
  const [task, setTask] = useState<TranslationTask | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [approving, setApproving] = useState(false)
  const [translating, setTranslating] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editedContent, setEditedContent] = useState<any>(null)
  const [saving, setSaving] = useState(false)

  async function loadTask() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/translations/${id}`)
      if (!res.ok) throw new Error('Failed to load task')
      const data = await res.json()
      setTask(data.task)
      setEditedContent(data.task.draftContent)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }

  async function handleSave() {
    setSaving(true)
    try {
      const res = await fetch(`/api/admin/translations/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          draftContent: editedContent,
        }),
      })

      if (!res.ok) throw new Error('Failed to save')
      
      const data = await res.json()
      setTask(data.task)
      setIsEditing(false)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  function handleCancel() {
    if (confirm('确定要取消编辑吗？未保存的更改将丢失。')) {
      setEditedContent(task?.draftContent)
      setIsEditing(false)
    }
  }

  async function handleApprove() {
    if (!confirm('确认要应用此翻译吗？')) return
    
    setApproving(true)
    try {
      const res = await fetch(`/api/admin/translations/${id}/approve`, {
        method: 'POST',
      })
      if (!res.ok) throw new Error('Failed to approve')
      
      alert('翻译已确认并应用')
      router.push('/admin/translations')
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to approve')
    } finally {
      setApproving(false)
    }
  }

  async function handleTranslate() {
    if (!confirm('确定要执行翻译吗？')) return
    
    setTranslating(true)
    try {
      const res = await fetch(`/api/admin/translations/${id}/translate`, {
        method: 'POST',
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Translation failed')
      }
      
      // Reload task to get updated sourceContent and draftContent
      await loadTask()
      alert('翻译完成！')
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Translation failed')
    } finally {
      setTranslating(false)
    }
  }

  useEffect(() => {
    void loadTask()
  }, [id])

  if (loading) {
    return <div className="text-gray-600">加载中...</div>
  }

  if (error || !task) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">
        {error || '未找到翻译任务'}
      </div>
    )
  }

  const languageLabels: Record<string, string> = {
    en: 'English',
    ja: '日本語',
  }

  const entityTypeLabels: Record<string, string> = {
    article: '文章',
    city: '城市',
    anime: '动漫',
  }

  const isTipTapContent = (content: any) => {
    return content && typeof content === 'object' && content.type === 'doc'
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link
            href="/admin/translations"
            className="text-sm text-brand-600 hover:underline"
          >
            ← 返回列表
          </Link>
          <h1 className="mt-2 text-2xl font-bold">翻译详情</h1>
          <div className="mt-2 flex items-center gap-2">
            <span className="rounded bg-blue-100 px-2 py-1 text-xs font-medium text-blue-700">
              {entityTypeLabels[task.entityType]}
            </span>
            <span className="text-sm text-gray-600">→</span>
            <span className="rounded bg-purple-100 px-2 py-1 text-xs font-medium text-purple-700">
              {languageLabels[task.targetLanguage]}
            </span>
            <span className="rounded bg-amber-100 px-2 py-1 text-xs font-medium text-amber-700">
              {task.status}
            </span>
          </div>
        </div>
        <div className="flex gap-2">
          {(task.status === 'pending' || task.status === 'failed') && (
            <button
              onClick={handleTranslate}
              disabled={translating}
              className="rounded-md bg-blue-500 px-4 py-2 text-white hover:bg-blue-600 disabled:opacity-50"
            >
              {translating ? '翻译中...' : '执行翻译'}
            </button>
          )}
          {task.status === 'ready' && task.draftContent && !isEditing && (
            <>
              {isTipTapContent(task.draftContent) && (
                <button
                  onClick={() => setIsEditing(true)}
                  className="rounded-md border border-gray-300 bg-white px-4 py-2 text-gray-700 hover:bg-gray-50"
                >
                  编辑翻译
                </button>
              )}
              <button
                onClick={handleApprove}
                disabled={approving}
                className="rounded-md bg-brand-500 px-4 py-2 text-white hover:bg-brand-600 disabled:opacity-50"
              >
                {approving ? '处理中...' : '确认翻译'}
              </button>
            </>
          )}
          {isEditing && (
            <>
              <button
                onClick={handleCancel}
                disabled={saving}
                className="rounded-md border border-gray-300 bg-white px-4 py-2 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                取消
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="rounded-md bg-blue-500 px-4 py-2 text-white hover:bg-blue-600 disabled:opacity-50"
              >
                {saving ? '保存中...' : '保存'}
              </button>
            </>
          )}
        </div>
      </div>

      {task.error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">
          <strong>错误:</strong> {task.error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">源内容 (中文)</h2>
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
            {task.sourceContent ? (
              isTipTapContent(task.sourceContent) ? (
                <TipTapPreview content={task.sourceContent} mode="preview" />
              ) : (
                <pre className="whitespace-pre-wrap text-sm">
                  {JSON.stringify(task.sourceContent, null, 2)}
                </pre>
              )
            ) : (
              <p className="text-gray-500">暂无源内容</p>
            )}
          </div>
        </div>

        <div className="space-y-3">
          <h2 className="text-lg font-semibold">
            翻译内容 ({languageLabels[task.targetLanguage]})
          </h2>
          <div className="rounded-lg border border-gray-200 bg-white p-4">
            {task.draftContent ? (
              isTipTapContent(task.draftContent) ? (
                <TipTapPreview 
                  content={isEditing ? editedContent : task.draftContent} 
                  mode={isEditing ? 'edit' : 'preview'}
                  onChange={setEditedContent}
                />
              ) : (
                <pre className="whitespace-pre-wrap text-sm">
                  {JSON.stringify(task.draftContent, null, 2)}
                </pre>
              )
            ) : (
              <p className="text-gray-500">翻译尚未生成</p>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">
        <p>
          <strong>任务 ID:</strong> {task.id}
        </p>
        <p>
          <strong>实体 ID:</strong> {task.entityId}
        </p>
        <p>
          <strong>创建时间:</strong>{' '}
          {new Date(task.createdAt).toLocaleString('zh-CN')}
        </p>
      </div>
    </div>
  )
}
