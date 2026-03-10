'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Editor } from '@tiptap/react'
import { useTranslationAutoSave } from '../../../../../hooks/useTranslationAutoSave'
import { useAdminToast } from '@/hooks/useAdminToast'
import { useAdminConfirm } from '@/hooks/useAdminConfirm'
import type {
  HistoryItem,
  RelatedArticle,
  TranslatedArticle,
  TranslationDetailProps,
  TranslationTask,
} from './types'
import { getContentJson, hasEditableContent } from './utils'

export function useTranslationDetailController({ id }: TranslationDetailProps) {
  const router = useRouter()
  const toast = useAdminToast()
  const askForConfirm = useAdminConfirm()
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
  const [showHistory, setShowHistory] = useState(false)
  const [historyList, setHistoryList] = useState<HistoryItem[]>([])
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [rollingBack, setRollingBack] = useState<string | null>(null)
  const [editor, setEditor] = useState<Editor | null>(null)
  const [retranslateMode, setRetranslateMode] = useState<'full' | 'selection'>(
    'full'
  )
  const [selectedText, setSelectedText] = useState('')
  const [updating, setUpdating] = useState(false)
  const [relatedArticle, setRelatedArticle] = useState<RelatedArticle | null>(null)
  const [translatedArticle, setTranslatedArticle] =
    useState<TranslatedArticle | null>(null)

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
      setRelatedArticle(data.relatedArticle)
      setTranslatedArticle(data.translatedArticle)

      if (data.task.status === 'approved' && data.translatedArticle?.contentJson) {
        setEditedContent({
          title: data.translatedArticle.title,
          description: data.translatedArticle.description,
          seoTitle: data.translatedArticle.seoTitle,
          contentJson: data.translatedArticle.contentJson,
        })
      } else {
        setEditedContent(data.task.draftContent)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }

  async function loadHistory() {
    if (loadingHistory) return
    setLoadingHistory(true)
    try {
      const res = await fetch(`/api/admin/translations/${id}/history`)
      if (!res.ok) throw new Error('Failed to load history')
      const data = await res.json()
      setHistoryList(data.history || [])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load history')
    } finally {
      setLoadingHistory(false)
    }
  }

  async function handleRollback(historyId: string) {
    const accepted = await askForConfirm({
      title: '确认回滚翻译版本',
      description: '这将覆盖当前翻译内容，且不可撤销。',
      confirmLabel: '确认回滚',
      cancelLabel: '取消',
      tone: 'danger',
    })
    if (!accepted) return

    setRollingBack(historyId)
    try {
      const res = await fetch(`/api/admin/translations/${id}/rollback`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ historyId }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Rollback failed')
      }

      toast.success('回滚成功')
      await loadTask()
      setShowHistory(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Rollback failed')
    } finally {
      setRollingBack(null)
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
      toast.error(err instanceof Error ? err.message : 'Retranslation failed')
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
          text,
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
      toast.error(err instanceof Error ? err.message : 'Translation failed')
    } finally {
      setRetranslating(false)
    }
  }

  async function applyRetranslation() {
    if (!task) return

    if (
      retranslateMode === 'selection' &&
      editor &&
      typeof previewContent === 'string'
    ) {
      editor.chain().focus().insertContent(previewContent).run()
      setShowPreview(false)
      setPreviewContent(null)
      return
    }

    if (!previewContent) return

    setRetranslating(true)
    try {
      const res = await fetch('/api/admin/retranslate/apply', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          translationTaskId: id,
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

      setEditedContent(previewContent)
      setShowPreview(false)
      setPreviewContent(null)
      toast.success('翻译已应用并保存')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Apply failed')
    } finally {
      setRetranslating(false)
    }
  }

  async function handleUpdatePublished() {
    if (!task || !translatedArticle) return
    const accepted = await askForConfirm({
      title: '确认更新已发布文章',
      description: '该操作将覆盖线上内容。',
      confirmLabel: '确认更新',
      cancelLabel: '取消',
      tone: 'danger',
    })
    if (!accepted) return

    setUpdating(true)
    try {
      const res = await fetch(`/api/admin/translations/${id}/update-published`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          articleUpdatedAt: translatedArticle.updatedAt,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Update failed')
      }

      toast.success('文章更新成功')
      await loadTask()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Update failed')
    } finally {
      setUpdating(false)
    }
  }

  async function handleApprove() {
    setApproving(true)
    try {
      const res = await fetch(`/api/admin/translations/${id}/approve`, {
        method: 'POST',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Failed to approve')

      toast.success('翻译已确认并应用')
      router.push('/admin/translations')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to approve')
    } finally {
      setApproving(false)
    }
  }

  async function handleTranslate() {
    setTranslating(true)
    try {
      const res = await fetch(`/api/admin/translations/${id}/translate`, {
        method: 'POST',
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Translation failed')
      }

      await loadTask()
      toast.success('翻译完成')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Translation failed')
    } finally {
      setTranslating(false)
    }
  }

  useEffect(() => {
    if (showHistory && historyList.length === 0) {
      void loadHistory()
    }
  }, [showHistory, historyList.length])

  useEffect(() => {
    void loadTask()
  }, [id])

  const isArticleTask = task?.entityType === 'article'
  const isMapBangumiTask = task?.entityType === 'anitabi_bangumi'
  const isMapPointTask = task?.entityType === 'anitabi_point'
  const canEditTask = task
    ? isArticleTask
      ? hasEditableContent(task.draftContent)
      : Boolean(isMapBangumiTask || isMapPointTask)
    : false
  const contentJson = getContentJson(isEditing ? editedContent : task?.draftContent)
  const breadcrumbItems = [
    { name: '后台', href: '/admin' },
    { name: '翻译任务', href: '/admin/translations' },
    { name: task?.draftContent?.title || '任务详情', href: '#' },
  ]

  return {
    approving,
    applyRetranslation,
    breadcrumbItems,
    canEditTask,
    contentJson,
    editedContent,
    editor,
    error,
    handleApprove,
    handleRetranslate,
    handleRollback,
    handleSelectedTextRetranslate,
    handleTranslate,
    handleUpdatePublished,
    historyList,
    id,
    isArticleTask,
    isEditing,
    isMapBangumiTask,
    isMapPointTask,
    loadTask,
    loading,
    loadingHistory,
    previewContent,
    relatedArticle,
    retranslateMode,
    retranslating,
    rollingBack,
    saveError,
    saveState,
    selectedText,
    setEditedContent,
    setEditor,
    setIsEditing,
    setShowHistory,
    setShowPreview,
    showHistory,
    showPreview,
    task,
    translatedArticle,
    translating,
    updating,
  }
}

export type TranslationDetailController = ReturnType<
  typeof useTranslationDetailController
>
