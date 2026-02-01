'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import TipTapPreview from '@/components/translation/TipTapPreview'
import ArticleToc from '@/components/toc/ArticleToc'
import PostMeta from '@/components/blog/PostMeta'
import Breadcrumbs from '@/components/layout/Breadcrumbs'
import { useTranslationAutoSave } from '../../../../../hooks/useTranslationAutoSave'
import { BubbleMenu } from '@tiptap/react/menus'
import { type Editor } from '@tiptap/react'

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
  const [showPreview, setShowPreview] = useState(false)
  const [previewContent, setPreviewContent] = useState<any>(null)
  const [retranslating, setRetranslating] = useState(false)
  
  const [editor, setEditor] = useState<Editor | null>(null)
  const [retranslateMode, setRetranslateMode] = useState<'full' | 'selection'>('full')
  const [selectedText, setSelectedText] = useState<string>('')

  const { saveState, saveError } = useTranslationAutoSave({
    translationId: id,
    draftContent: editedContent,
  })

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

  async function handleRetranslate() {
    if (!task) return
    setRetranslating(true)
    setRetranslateMode('full')
    try {
      const res = await fetch('/api/admin/retranslate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          entityType: task.entityType,
          entityId: task.entityId,
          targetLang: task.targetLanguage,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Retranslation failed')
      }

      const data = await res.json()
      setPreviewContent(data.preview)
      setShowPreview(true)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Retranslation failed')
    } finally {
      setRetranslating(false)
    }
  }

  async function handleSelectedTextRetranslate() {
    if (!task || !editor) return
    const selection = editor.state.selection
    if (selection.empty) return

    const text = editor.state.doc.textBetween(selection.from, selection.to, ' ')
    if (!text.trim()) return

    setRetranslating(true)
    setRetranslateMode('selection')
    setSelectedText(text)
    
    try {
      const res = await fetch('/api/admin/retranslate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          entityType: 'text',
          text: text,
          targetLang: task.targetLanguage,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Translation failed')
      }

      const data = await res.json()
      setPreviewContent(data.preview)
      setShowPreview(true)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Translation failed')
    } finally {
      setRetranslating(false)
    }
  }

  async function applyRetranslation() {
    if (!task) return
    
    if (retranslateMode === 'selection' && editor && typeof previewContent === 'string') {
      // For selection mode, just insert into editor (no API call needed)
      editor.chain().focus().insertContent(previewContent).run()
      setShowPreview(false)
      setPreviewContent(null)
    } else if (previewContent) {
      // For full article mode, call apply API to save to database
      setRetranslating(true)
      try {
        const res = await fetch('/api/admin/retranslate/apply', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            entityType: task.entityType,
            entityId: task.entityId,
            targetLang: task.targetLanguage,
            preview: previewContent,
          }),
        })

        if (!res.ok) {
          const data = await res.json()
          throw new Error(data.error || 'Apply failed')
        }

        // Update local state with saved content
        setEditedContent(previewContent)
        setShowPreview(false)
        setPreviewContent(null)
        alert('翻译已应用并保存')
      } catch (err) {
        alert(err instanceof Error ? err.message : 'Apply failed')
      } finally {
        setRetranslating(false)
      }
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

  // Extract TipTap content (supports two formats)
  const getContentJson = (content: any) => {
    if (!content) return null
    // If content itself is TipTap format
    if (content.type === 'doc') return content
    // If content has contentJson property (article translation format)
    if (content.contentJson && content.contentJson.type === 'doc') return content.contentJson
    return null
  }

  const hasEditableContent = (content: any) => {
    return getContentJson(content) !== null
  }

  const breadcrumbItems = [
    { name: '后台', href: '/admin' },
    { name: '翻译任务', href: '/admin/translations' },
    { name: task.draftContent?.title || '任务详情', href: '#' },
  ]

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
        <div className="flex items-center gap-4">
          {isEditing && (
            <>
              {saveState === 'saving' && <span className="text-sm text-gray-600">保存中…</span>}
              {saveState === 'saved' && <span className="text-sm text-emerald-700">已保存</span>}
              {saveState === 'error' && saveError && (
                <span className="text-sm text-red-600">{saveError}</span>
              )}
            </>
          )}
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
              {hasEditableContent(task.draftContent) && (
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
                onClick={handleRetranslate}
                disabled={retranslating}
                className="mr-2 rounded-md border border-purple-300 bg-purple-50 px-4 py-2 text-purple-700 hover:bg-purple-100 disabled:opacity-50"
              >
                {retranslating ? '翻译中...' : '重新翻译全文'}
              </button>
              <button
                onClick={handleApprove}
              disabled={approving}
              className="rounded-md bg-brand-500 px-4 py-2 text-white hover:bg-brand-600 disabled:opacity-50"
            >
              {approving ? '处理中...' : '确认翻译'}
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

      <div className="mx-auto w-full max-w-7xl px-0 lg:px-4">
        <div className="flex items-start gap-12">
          <aside className="hidden lg:block lg:sticky lg:top-24 lg:shrink-0 lg:w-72">
            <ArticleToc />
          </aside>
          <main className="min-w-0 flex-1 pb-24">
            <article className="prose prose-pink max-w-none w-full" data-seichi-article-content="true">
              <div className="not-prose mb-4">
                <Breadcrumbs items={breadcrumbItems} />
              </div>

              <div className="mb-8 not-prose">
                <PostMeta 
                  anime={[]} 
                  publishDate={new Date(task.createdAt).toLocaleDateString()} 
                />
              </div>

              {isEditing && (
                <div className="space-y-4 mb-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">
                      标题
                    </label>
                    <input
                      type="text"
                      className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-brand-500 focus:ring-brand-500"
                      value={editedContent?.title || ''}
                      onChange={(e) => setEditedContent({ ...editedContent, title: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">
                      SEO 标题
                    </label>
                    <input
                      type="text"
                      className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-brand-500 focus:ring-brand-500"
                      value={editedContent?.seoTitle || ''}
                      onChange={(e) => setEditedContent({ ...editedContent, seoTitle: e.target.value })}
                      placeholder="留空则使用标题"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">
                      描述
                    </label>
                    <textarea
                      rows={3}
                      className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-brand-500 focus:ring-brand-500"
                      value={editedContent?.description || ''}
                      onChange={(e) => setEditedContent({ ...editedContent, description: e.target.value })}
                      placeholder="用于搜索结果摘要"
                    />
                  </div>
                </div>
              )}

              <div className="rounded-lg bg-white min-h-[500px] relative">
                {isEditing && editor && (
                  <BubbleMenu editor={editor}>
                    <div className="flex items-center gap-1 rounded bg-white p-1 shadow-lg ring-1 ring-gray-200">
                      <button
                        onClick={handleSelectedTextRetranslate}
                        className="rounded px-2 py-1 text-sm text-purple-600 hover:bg-purple-50"
                      >
                        ✨ 重译选中
                      </button>
                    </div>
                  </BubbleMenu>
                )}
                
                {task.draftContent ? (
                  (() => {
                    const contentJson = getContentJson(isEditing ? editedContent : task.draftContent)
                    if (contentJson) {
                      return (
                        <TipTapPreview 
                          content={contentJson}
                          mode={isEditing ? 'edit' : 'preview'}
                          onChange={(newContent) => {
                            setEditedContent({ ...editedContent, contentJson: newContent })
                          }}
                          onEditorReady={setEditor}
                        />
                      )
                    }
                    return (
                      <pre className="whitespace-pre-wrap text-sm">
                        {JSON.stringify(task.draftContent, null, 2)}
                      </pre>
                    )
                  })()
                ) : (
                  <p className="text-gray-500 p-4">翻译尚未生成</p>
                )}
              </div>
            </article>
          </main>
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

      {showPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="flex max-h-[90vh] w-full max-w-6xl flex-col rounded-lg bg-white shadow-xl">
            <div className="flex items-center justify-between border-b px-6 py-4">
              <h3 className="text-lg font-medium">翻译预览 ({retranslateMode === 'selection' ? '选中内容' : '全文'})</h3>
              <button
                onClick={() => setShowPreview(false)}
                className="text-gray-400 hover:text-gray-500"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-auto p-6">
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <h4 className="mb-2 font-medium text-gray-700">当前内容</h4>
                  <div className="rounded border p-4 opacity-50 bg-gray-50">
                    {retranslateMode === 'selection' ? (
                      <div className="whitespace-pre-wrap">{selectedText}</div>
                    ) : (
                      editedContent && isTipTapContent(editedContent) ? (
                        <div className="pointer-events-none origin-top scale-90">
                          <TipTapPreview content={editedContent} mode="preview" />
                        </div>
                      ) : (
                        <pre className="max-h-96 overflow-auto whitespace-pre-wrap text-xs">
                          {JSON.stringify(editedContent, null, 2)}
                        </pre>
                      )
                    )}
                  </div>
                </div>
                <div>
                  <h4 className="mb-2 font-medium text-gray-700">
                    重新翻译结果
                  </h4>
                  <div className="rounded border border-purple-200 bg-purple-50 p-4">
                    {previewContent && isTipTapContent(previewContent) ? (
                      <TipTapPreview content={previewContent} mode="preview" />
                    ) : (
                      <pre className="max-h-96 overflow-auto whitespace-pre-wrap text-sm font-sans">
                        {typeof previewContent === 'string' ? previewContent : JSON.stringify(previewContent, null, 2)}
                      </pre>
                    )}
                  </div>
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-3 rounded-b-lg border-t bg-gray-50 px-6 py-4">
              <button
                onClick={() => setShowPreview(false)}
                className="rounded-md border border-gray-300 bg-white px-4 py-2 text-gray-700 hover:bg-gray-50"
              >
                取消
              </button>
              <button
                onClick={applyRetranslation}
                className="rounded-md bg-brand-500 px-4 py-2 text-white hover:bg-brand-600"
              >
                应用更改
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

