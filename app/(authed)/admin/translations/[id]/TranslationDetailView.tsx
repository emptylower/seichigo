'use client'

import Link from 'next/link'
import dynamic from 'next/dynamic'
import Breadcrumbs from '@/components/layout/Breadcrumbs'
import PostMeta from '@/components/blog/PostMeta'
import { AdminErrorState } from '@/components/admin/state/AdminErrorState'
import { AdminSkeleton } from '@/components/admin/state/AdminSkeleton'
import type { TranslationDetailController } from './useTranslationDetailController'
import {
  ENTITY_TYPE_LABELS,
  isTipTapContent,
  LANGUAGE_LABELS,
  STATUS_LABELS,
} from './utils'

const TipTapPreview = dynamic(() => import('@/components/translation/TipTapPreview'), {
  ssr: false,
  loading: () => (
    <div className="min-h-[10rem] rounded-md border bg-white p-4 text-sm text-gray-500">
      编辑器加载中…
    </div>
  ),
})

const TipTapBubbleMenu = dynamic(
  () => import('@tiptap/react/menus').then((mod) => mod.BubbleMenu),
  { ssr: false }
)

type Props = {
  controller: TranslationDetailController
}

export default function TranslationDetailView({ controller }: Props) {
  if (controller.loading) {
    return <AdminSkeleton rows={10} />
  }

  if (controller.error || !controller.task) {
    return (
      <AdminErrorState
        message={controller.error || '未找到翻译任务'}
        onRetry={() => void controller.loadTask()}
      />
    )
  }

  const { task } = controller

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
              {ENTITY_TYPE_LABELS[task.entityType]}
            </span>
            <span className="text-sm text-gray-600">→</span>
            <span className="rounded bg-purple-100 px-2 py-1 text-xs font-medium text-purple-700">
              {LANGUAGE_LABELS[task.targetLanguage]}
            </span>
            <span className="rounded bg-amber-100 px-2 py-1 text-xs font-medium text-amber-700">
              {STATUS_LABELS[task.status] || task.status}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-4">
          {controller.isEditing && (
            <>
              {controller.saveState === 'saving' && (
                <span className="text-sm text-gray-600">保存中…</span>
              )}
              {controller.saveState === 'saved' && (
                <span className="text-sm text-emerald-700">已保存</span>
              )}
              {controller.saveState === 'error' && controller.saveError && (
                <span className="text-sm text-red-600">{controller.saveError}</span>
              )}
            </>
          )}

          {(task.status === 'pending' || task.status === 'failed') && (
            <button
              onClick={controller.handleTranslate}
              disabled={controller.translating}
              className="rounded-md bg-blue-500 px-4 py-2 text-white hover:bg-blue-600 disabled:opacity-50"
            >
              {controller.translating ? '翻译中...' : '执行翻译'}
            </button>
          )}

          {task.status === 'ready' && task.draftContent && !controller.isEditing && (
            <>
              {controller.canEditTask && (
                <button
                  onClick={() => controller.setIsEditing(true)}
                  className="rounded-md border border-gray-300 bg-white px-4 py-2 text-gray-700 hover:bg-gray-50"
                >
                  编辑翻译
                </button>
              )}
              <button
                onClick={controller.handleRetranslate}
                disabled={controller.retranslating}
                className="rounded-md border border-purple-300 bg-purple-50 px-4 py-2 text-purple-700 hover:bg-purple-100 disabled:opacity-50"
              >
                {controller.retranslating ? '翻译中...' : '重新翻译'}
              </button>
              <button
                onClick={controller.handleApprove}
                disabled={controller.approving}
                className="rounded-md bg-brand-500 px-4 py-2 text-white hover:bg-brand-600 disabled:opacity-50"
              >
                {controller.approving ? '处理中...' : '确认翻译'}
              </button>
            </>
          )}

          {task.status === 'approved' && !controller.isEditing && (
            <>
              <button
                onClick={() => controller.setIsEditing(true)}
                disabled={!controller.canEditTask}
                className="rounded-md border border-gray-300 bg-white px-4 py-2 text-gray-700 hover:bg-gray-50"
              >
                编辑翻译
              </button>
              <button
                onClick={controller.handleRetranslate}
                disabled={controller.retranslating}
                className="rounded-md border border-purple-300 bg-purple-50 px-4 py-2 text-purple-700 hover:bg-purple-100 disabled:opacity-50"
              >
                {controller.retranslating ? '翻译中...' : '重新翻译'}
              </button>
              {controller.isArticleTask ? (
                <button
                  onClick={controller.handleUpdatePublished}
                  disabled={controller.updating}
                  className="rounded-md bg-brand-500 px-4 py-2 text-white hover:bg-brand-600 disabled:opacity-50"
                >
                  {controller.updating ? '更新中...' : '更新发布'}
                </button>
              ) : (
                <button
                  onClick={controller.handleApprove}
                  disabled={controller.approving}
                  className="rounded-md bg-brand-500 px-4 py-2 text-white hover:bg-brand-600 disabled:opacity-50"
                >
                  {controller.approving ? '处理中...' : '更新译文'}
                </button>
              )}
            </>
          )}

          {controller.isEditing && (
            <>
              <button
                onClick={controller.handleRetranslate}
                disabled={controller.retranslating}
                className="mr-2 rounded-md border border-purple-300 bg-purple-50 px-4 py-2 text-purple-700 hover:bg-purple-100 disabled:opacity-50"
              >
                {controller.retranslating ? '翻译中...' : '重新翻译全文'}
              </button>
              <button
                onClick={
                  task.status === 'approved' && controller.isArticleTask
                    ? controller.handleUpdatePublished
                    : controller.handleApprove
                }
                disabled={
                  task.status === 'approved' && controller.isArticleTask
                    ? controller.updating
                    : controller.approving
                }
                className="rounded-md bg-brand-500 px-4 py-2 text-white hover:bg-brand-600 disabled:opacity-50"
              >
                {task.status === 'approved' && controller.isArticleTask
                  ? controller.updating
                    ? '更新中...'
                    : '更新发布'
                  : controller.approving
                    ? '处理中...'
                    : '确认翻译'}
              </button>
            </>
          )}

          {task.entityType === 'article' &&
            task.status === 'approved' &&
            !controller.isEditing && (
              <button
                onClick={() => controller.setShowHistory(!controller.showHistory)}
                className="rounded-md border border-gray-300 bg-white px-4 py-2 text-gray-700 hover:bg-gray-50"
              >
                {controller.showHistory ? '隐藏' : '显示'}版本历史
              </button>
            )}
        </div>
      </div>

      {controller.showHistory && (
        <div className="mb-6 mx-auto w-full px-4 lg:px-8">
          <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
              <h3 className="text-sm font-medium text-gray-900">版本历史</h3>
            </div>
            <div className="p-4">
              {controller.loadingHistory ? (
                <div className="py-4 text-center text-sm text-gray-500">
                  加载中...
                </div>
              ) : controller.historyList.length === 0 ? (
                <div className="py-4 text-center text-sm text-gray-500">
                  暂无历史版本
                </div>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {controller.historyList.map((history) => (
                    <li
                      key={history.id}
                      className="flex items-center justify-between py-3"
                    >
                      <div className="flex flex-col">
                        <span className="text-sm font-medium text-gray-900">
                          {new Date(history.createdAt).toLocaleString('zh-CN')}
                        </span>
                        <span className="mt-0.5 text-xs text-gray-500">
                          操作者: {history.operatorName || '未知'}{' '}
                          <span className="mx-1 text-gray-300">|</span>{' '}
                          {history.action}
                        </span>
                      </div>
                      <button
                        onClick={() => controller.handleRollback(history.id)}
                        disabled={controller.rollingBack === history.id}
                        className="rounded border border-gray-300 bg-white px-3 py-1 text-xs text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
                      >
                        {controller.rollingBack === history.id ? '回滚中...' : '回滚'}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

      {task.error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">
          <strong>错误:</strong> {task.error}
        </div>
      )}

      <div className="mx-auto w-full px-4 lg:px-8">
        <main className="pb-24">
          <article
            className="prose prose-pink max-w-none w-full"
            data-seichi-article-content="true"
          >
            <div className="not-prose mb-4">
              <Breadcrumbs items={controller.breadcrumbItems} />
            </div>

            <div className="mb-8 not-prose">
              <PostMeta
                anime={[]}
                publishDate={new Date(task.createdAt).toLocaleDateString()}
              />
            </div>

            {controller.isEditing && (
              <div className="mb-6 space-y-4">
                {controller.isArticleTask ? (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-gray-700">
                        标题
                      </label>
                      <input
                        type="text"
                        className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-brand-500 focus:ring-brand-500"
                        value={controller.editedContent?.title || ''}
                        onChange={(e) =>
                          controller.setEditedContent({
                            ...controller.editedContent,
                            title: e.target.value,
                          })
                        }
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700">
                        SEO 标题
                      </label>
                      <input
                        type="text"
                        className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-brand-500 focus:ring-brand-500"
                        value={controller.editedContent?.seoTitle || ''}
                        onChange={(e) =>
                          controller.setEditedContent({
                            ...controller.editedContent,
                            seoTitle: e.target.value,
                          })
                        }
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
                        value={controller.editedContent?.description || ''}
                        onChange={(e) =>
                          controller.setEditedContent({
                            ...controller.editedContent,
                            description: e.target.value,
                          })
                        }
                        placeholder="用于搜索结果摘要"
                      />
                    </div>
                  </>
                ) : null}

                {controller.isMapBangumiTask ? (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-gray-700">
                        作品标题
                      </label>
                      <input
                        type="text"
                        className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-brand-500 focus:ring-brand-500"
                        value={controller.editedContent?.title || ''}
                        onChange={(e) =>
                          controller.setEditedContent({
                            ...controller.editedContent,
                            title: e.target.value,
                          })
                        }
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700">
                        城市
                      </label>
                      <input
                        type="text"
                        className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-brand-500 focus:ring-brand-500"
                        value={controller.editedContent?.city || ''}
                        onChange={(e) =>
                          controller.setEditedContent({
                            ...controller.editedContent,
                            city: e.target.value,
                          })
                        }
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700">
                        描述
                      </label>
                      <textarea
                        rows={4}
                        className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-brand-500 focus:ring-brand-500"
                        value={controller.editedContent?.description || ''}
                        onChange={(e) =>
                          controller.setEditedContent({
                            ...controller.editedContent,
                            description: e.target.value,
                          })
                        }
                      />
                    </div>
                  </>
                ) : null}

                {controller.isMapPointTask ? (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-gray-700">
                        点位名称
                      </label>
                      <input
                        type="text"
                        className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-brand-500 focus:ring-brand-500"
                        value={controller.editedContent?.name || ''}
                        onChange={(e) =>
                          controller.setEditedContent({
                            ...controller.editedContent,
                            name: e.target.value,
                          })
                        }
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700">
                        点位备注
                      </label>
                      <textarea
                        rows={4}
                        className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-brand-500 focus:ring-brand-500"
                        value={controller.editedContent?.note || ''}
                        onChange={(e) =>
                          controller.setEditedContent({
                            ...controller.editedContent,
                            note: e.target.value,
                          })
                        }
                      />
                    </div>
                  </>
                ) : null}
              </div>
            )}

            <div className="relative min-h-[500px] rounded-lg bg-white">
              {controller.isEditing && controller.isArticleTask && controller.editor && (
                <TipTapBubbleMenu editor={controller.editor}>
                  <div className="flex items-center gap-1 rounded bg-white p-1 shadow-lg ring-1 ring-gray-200">
                    <button
                      onClick={controller.handleSelectedTextRetranslate}
                      className="rounded px-2 py-1 text-sm text-purple-600 hover:bg-purple-50"
                    >
                      ✨ 重译选中
                    </button>
                  </div>
                </TipTapBubbleMenu>
              )}

              {task.draftContent ? (
                controller.contentJson ? (
                  <TipTapPreview
                    content={controller.contentJson}
                    mode={controller.isEditing ? 'edit' : 'preview'}
                    onChange={(newContent) => {
                      controller.setEditedContent({
                        ...controller.editedContent,
                        contentJson: newContent,
                      })
                    }}
                    onEditorReady={controller.setEditor}
                  />
                ) : (
                  <pre className="whitespace-pre-wrap text-sm">
                    {JSON.stringify(
                      controller.isEditing ? controller.editedContent : task.draftContent,
                      null,
                      2
                    )}
                  </pre>
                )
              ) : (
                <p className="p-4 text-gray-500">翻译尚未生成</p>
              )}
            </div>
          </article>
        </main>
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

      {controller.showPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="flex max-h-[90vh] w-full max-w-6xl flex-col rounded-lg bg-white shadow-xl">
            <div className="flex items-center justify-between border-b px-6 py-4">
              <h3 className="text-lg font-medium">
                翻译预览 (
                {controller.retranslateMode === 'selection' ? '选中内容' : '全文'})
              </h3>
              <button
                onClick={() => controller.setShowPreview(false)}
                className="text-gray-400 hover:text-gray-500"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-auto p-6">
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <h4 className="mb-2 font-medium text-gray-700">当前内容</h4>
                  <div className="rounded border bg-gray-50 p-4 opacity-50">
                    {controller.retranslateMode === 'selection' ? (
                      <div className="whitespace-pre-wrap">
                        {controller.selectedText}
                      </div>
                    ) : controller.editedContent &&
                      isTipTapContent(controller.editedContent) ? (
                      <div className="pointer-events-none origin-top scale-90">
                        <TipTapPreview
                          content={controller.editedContent}
                          mode="preview"
                        />
                      </div>
                    ) : (
                      <pre className="max-h-96 overflow-auto whitespace-pre-wrap text-xs">
                        {JSON.stringify(controller.editedContent, null, 2)}
                      </pre>
                    )}
                  </div>
                </div>
                <div>
                  <h4 className="mb-2 font-medium text-gray-700">
                    重新翻译结果
                  </h4>
                  <div className="rounded border border-purple-200 bg-purple-50 p-4">
                    {controller.previewContent &&
                    isTipTapContent(controller.previewContent) ? (
                      <TipTapPreview
                        content={controller.previewContent}
                        mode="preview"
                      />
                    ) : (
                      <pre className="max-h-96 overflow-auto whitespace-pre-wrap font-sans text-sm">
                        {typeof controller.previewContent === 'string'
                          ? controller.previewContent
                          : JSON.stringify(controller.previewContent, null, 2)}
                      </pre>
                    )}
                  </div>
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-3 rounded-b-lg border-t bg-gray-50 px-6 py-4">
              <button
                onClick={() => controller.setShowPreview(false)}
                className="rounded-md border border-gray-300 bg-white px-4 py-2 text-gray-700 hover:bg-gray-50"
              >
                取消
              </button>
              <button
                onClick={controller.applyRetranslation}
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
