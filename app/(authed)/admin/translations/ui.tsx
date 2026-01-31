'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import Button from '@/components/shared/Button'

type TranslationTask = {
  id: string
  entityType: string
  entityId: string
  targetLanguage: string
  status: string
  createdAt: string
}

type UntranslatedItem = {
  entityType: string
  entityId: string
  title: string
  date: string
  missingLanguages: string[]
}

export default function TranslationsUI() {
  const [tasks, setTasks] = useState<TranslationTask[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('ready')

  const [untranslatedItems, setUntranslatedItems] = useState<UntranslatedItem[]>([])
  const [untranslatedLoading, setUntranslatedLoading] = useState(true)

  const [showBatchModal, setShowBatchModal] = useState(false)
  const [batchEntityType, setBatchEntityType] = useState<'article' | 'city' | 'anime'>('article')
  const [batchLanguages, setBatchLanguages] = useState<string[]>(['en', 'ja'])
  const [batchLoading, setBatchLoading] = useState(false)

  async function handleBatchSubmit() {
    if (batchLanguages.length === 0) return
    setBatchLoading(true)
    try {
      const res = await fetch('/api/admin/translations/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entityType: batchEntityType,
          targetLanguages: batchLanguages,
        }),
      })
      
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '批量翻译失败')
      
      alert(`成功创建 ${data.created} 个翻译任务，跳过 ${data.skipped} 个`)
      setShowBatchModal(false)
      void loadTasks()
    } catch (error: any) {
      alert(error.message || '操作失败')
    } finally {
      setBatchLoading(false)
    }
  }

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

  async function loadUntranslated() {
    setUntranslatedLoading(true)
    try {
      const res = await fetch('/api/admin/translations/untranslated')
      const data = await res.json()
      setUntranslatedItems(data.items || [])
    } catch (error) {
      console.error('Failed to load untranslated items', error)
    } finally {
      setUntranslatedLoading(false)
    }
  }

  async function createTranslationTask(item: UntranslatedItem) {
    if (!confirm(`确定为 "${item.title}" 创建翻译任务吗？`)) return

    try {
      const res = await fetch('/api/admin/translations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entityType: item.entityType,
          entityId: item.entityId,
          targetLanguages: item.missingLanguages,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || '创建失败')
      }

      // Refresh both lists
      await Promise.all([loadTasks(), loadUntranslated()])
    } catch (error: any) {
      alert(error.message || '操作失败')
    }
  }

  useEffect(() => {
    void loadTasks()
  }, [filter])

  useEffect(() => {
    void loadUntranslated()
  }, [])

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
        <div className="flex items-center gap-2">
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
        <Button onClick={() => setShowBatchModal(true)}>批量翻译</Button>
      </div>

      <div className="space-y-4">
        <h2 className="text-lg font-medium">未翻译内容</h2>
        {untranslatedLoading ? (
          <div className="text-gray-500">加载中...</div>
        ) : untranslatedItems.length === 0 ? (
          <div className="rounded-lg border border-gray-200 bg-green-50 p-8 text-center text-green-600">
            🎉 所有内容都已有翻译任务
          </div>
        ) : (
          <div className="space-y-3">
            {untranslatedItems.map((item) => (
              <div
                key={`${item.entityType}-${item.entityId}`}
                className="rounded-lg border border-gray-200 bg-white p-4 hover:border-brand-300 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="rounded bg-blue-100 px-2 py-1 text-xs font-medium text-blue-700">
                      {entityTypeLabels[item.entityType] || item.entityType}
                    </span>
                    <span className="font-medium text-gray-900">{item.title}</span>
                    <div className="flex gap-1">
                      {item.missingLanguages.map((lang) => (
                        <span
                          key={lang}
                          className="rounded bg-red-100 px-2 py-1 text-xs font-medium text-red-700"
                        >
                          缺失: {languageLabels[lang] || lang}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500">
                      {new Date(item.date).toLocaleDateString('zh-CN')}
                    </span>
                    <Button
                      variant="ghost"
                      className="px-3 py-1 h-auto"
                      onClick={() => createTranslationTask(item)}
                    >
                      创建翻译任务
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-4">
        <h2 className="text-lg font-medium">任务列表</h2>
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

      <Dialog.Root open={showBatchModal} onOpenChange={setShowBatchModal}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 fade-in-0 animate-in" />
          <Dialog.Content className="fixed left-[50%] top-[50%] z-50 w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-white p-6 shadow-lg duration-200 animate-in fade-in-0 zoom-in-95 sm:rounded-lg">
            <div className="flex flex-col space-y-1.5 text-center sm:text-left">
              <Dialog.Title className="text-lg font-semibold leading-none tracking-tight">
                批量翻译
              </Dialog.Title>
              <Dialog.Description className="text-sm text-gray-500">
                创建批量翻译任务。系统将自动扫描未翻译的内容并生成任务。
              </Dialog.Description>
            </div>
            
            <div className="grid gap-4 py-4">
              <div className="space-y-2">
                <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                  实体类型
                </label>
                <select
                  value={batchEntityType}
                  onChange={(e) => setBatchEntityType(e.target.value as any)}
                  className="flex h-10 w-full items-center justify-between rounded-md border border-gray-200 bg-white px-3 py-2 text-sm placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <option value="article">文章 (Article)</option>
                  <option value="city">城市 (City)</option>
                  <option value="anime">动漫 (Anime)</option>
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium leading-none">
                  目标语言
                </label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={batchLanguages.includes('en')}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setBatchLanguages([...batchLanguages, 'en'])
                        } else {
                          setBatchLanguages(batchLanguages.filter(l => l !== 'en'))
                        }
                      }}
                      className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                    />
                    英语 (en)
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={batchLanguages.includes('ja')}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setBatchLanguages([...batchLanguages, 'ja'])
                        } else {
                          setBatchLanguages(batchLanguages.filter(l => l !== 'ja'))
                        }
                      }}
                      className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                    />
                    日语 (ja)
                  </label>
                </div>
              </div>
            </div>

            <div className="flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2">
              <Button variant="ghost" onClick={() => setShowBatchModal(false)}>
                取消
              </Button>
              <Button 
                onClick={handleBatchSubmit} 
                disabled={batchLoading || batchLanguages.length === 0}
              >
                {batchLoading ? '处理中...' : '开始生成'}
              </Button>
            </div>
            
            <Dialog.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-white transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-gray-100 data-[state=open]:text-gray-500">
              <X className="h-4 w-4" />
              <span className="sr-only">Close</span>
            </Dialog.Close>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

    </div>
  )
}
