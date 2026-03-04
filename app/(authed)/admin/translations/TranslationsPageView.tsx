'use client'

import Link from 'next/link'
import * as Dialog from '@radix-ui/react-dialog'
import { Loader2, X } from 'lucide-react'
import Button from '@/components/shared/Button'
import { AdminSkeleton } from '@/components/admin/state/AdminSkeleton'
import { AdminEmptyState } from '@/components/admin/state/AdminEmptyState'
import { AdminErrorState } from '@/components/admin/state/AdminErrorState'

export default function TranslationsPageView(props: any) {
  const { view, setView, setShowBatchModal, batchExecuting, showMapOpsPanel, setShowMapOpsPanel, mapActions, mapControlsBusy, approveAllReadyRunning, sampleApproving, bangumiBackfillCursor, pointBackfillCursor, mapOpsMessage, batchProgress, cancelBatchExecution, setBatchProgress, mapOpsProgress, setMapOpsProgress, mapOpsProgressPercent, formatMetricCount, oneKeyProgressPercent, q, setQ, setPage, entityType, setEntityType, targetLanguage, setTargetLanguage, pageSize, setPageSize, clampInt, setStatus, statusTabs, stats, statsLoading, status, tasksError, loadTasks, tasksLoading, tasks, buildPublicLinks, entityTypeLabels, languageLabels, statusLabels, articleStatusLabels, formatDateTime, total, page, totalPages, untranslatedQuery, setUntranslatedQuery, setUntranslatedPage, loadUntranslated, untranslatedLoading, untranslatedItems, untranslatedTotal, untranslatedPage, untranslatedPageSize, createTranslationTask, showBatchModal, batchTaskItems, batchSelectedIds, toggleBatchSelectAll, batchLoading, setBatchSelectedIds, batchError, toggleBatchItem, handleBatchSubmit } = props as any
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setView('tasks')}
            className={
              view === 'tasks'
                ? 'rounded-md bg-brand-500 px-3 py-2 text-sm text-white'
                : 'rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50'
            }
          >
            翻译任务
          </button>
          <button
            type="button"
            onClick={() => setView('untranslated')}
            className={
              view === 'untranslated'
                ? 'rounded-md bg-brand-500 px-3 py-2 text-sm text-white'
                : 'rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50'
            }
          >
            未翻译内容
          </button>
        </div>
        <Button onClick={() => setShowBatchModal(true)} disabled={batchExecuting}>
          批量翻译
        </Button>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-gray-900">地图翻译控制区</div>
            <div className="mt-1 text-xs text-gray-500">
              回填历史任务、增量补队、一键自动推进/手动推进队列，以及一键审核全部待审核（en + ja，不依赖 cron）。
            </div>
          </div>
          <Button type="button" variant="ghost" onClick={() => setShowMapOpsPanel((prev: boolean) => !prev)}>
            {showMapOpsPanel ? '收起控制区' : '展开控制区'}
          </Button>
        </div>
        {showMapOpsPanel ? (
          <>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => void mapActions.handleMapBackfill('anitabi_bangumi')}
                disabled={mapControlsBusy}
              >
                作品回填（1000）
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => void mapActions.handleMapBackfill('anitabi_point')}
                disabled={mapControlsBusy}
              >
                点位回填（1000）
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => void mapActions.handleMapIncrementalRefill()}
                disabled={mapControlsBusy}
              >
                增量补队
              </Button>
              <Button
                type="button"
                onClick={() => void mapActions.handleOneKeyAdvanceMapQueue()}
                disabled={mapControlsBusy}
              >
                一键自动推进
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => void mapActions.executeMapPendingBatch()}
                disabled={mapControlsBusy}
              >
                执行地图待翻译（单轮）
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => void mapActions.executeMapFailedBatch()}
                disabled={mapControlsBusy}
              >
                重试失败（单轮）
              </Button>
              <Button
                type="button"
                onClick={() => void mapActions.handleManualAdvanceMapQueue(10)}
                disabled={mapControlsBusy}
              >
                手动推进队列（10轮）
              </Button>
              <Button
                type="button"
                onClick={() => void mapActions.approveAllReadyTasks()}
                disabled={mapControlsBusy}
              >
                {approveAllReadyRunning ? '一键审核中...' : '一键审核全部待审核'}
              </Button>
              <Button
                type="button"
                onClick={() => void mapActions.approveMapSampleBatch()}
                disabled={mapControlsBusy}
              >
                {sampleApproving ? '抽检发布中...' : '抽检并批量发布'}
              </Button>
            </div>
            <div className="mt-2 text-xs text-gray-500">
              回填游标：作品 {bangumiBackfillCursor || '-'} / 点位 {pointBackfillCursor || '-'}
            </div>
            {mapOpsMessage ? (
              <div className="mt-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700">
                {mapOpsMessage}
              </div>
            ) : null}
          </>
        ) : (
          <div className="mt-2 text-xs text-gray-500">
            默认折叠控制区以减轻首屏渲染压力，需要时再展开。
          </div>
        )}
      </div>

      {batchProgress ? (
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-gray-900">批量任务进度</div>
              <div className="mt-1 text-sm text-gray-700">
                已处理 {batchProgress.processed} / {batchProgress.total}，成功 {batchProgress.success}，失败 {batchProgress.failed}，跳过 {batchProgress.skipped}
              </div>
              <div className="mt-1 text-xs text-gray-500">
                状态：
                {batchProgress.running
                  ? '执行中'
                  : batchProgress.cancelled
                    ? '已中断'
                    : '已完成'}
                {batchProgress.currentTaskId ? ` · 当前任务 ${batchProgress.currentTaskId}` : ''}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {batchProgress.running ? (
                <Button type="button" variant="ghost" onClick={cancelBatchExecution}>
                  中断执行
                </Button>
              ) : (
                <Button type="button" variant="ghost" onClick={() => setBatchProgress(null)}>
                  清除进度
                </Button>
              )}
            </div>
          </div>
        </div>
      ) : null}

      <Dialog.Root
        open={Boolean(mapOpsProgress)}
        onOpenChange={(open) => {
          if (!open && mapOpsProgress && !mapOpsProgress.running) {
            setMapOpsProgress(null)
          }
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[1px]" />
          <Dialog.Content className="fixed left-[50%] top-[50%] z-50 w-full max-w-lg translate-x-[-50%] translate-y-[-50%] rounded-lg border border-gray-200 bg-white p-5 shadow-xl">
            {mapOpsProgress ? (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <Dialog.Title className="text-base font-semibold text-gray-900">{mapOpsProgress.title}</Dialog.Title>
                    <Dialog.Description className="mt-1 text-sm text-gray-600">{mapOpsProgress.detail}</Dialog.Description>
                  </div>
                  {mapOpsProgress.running ? (
                    <Loader2 className="mt-0.5 h-5 w-5 animate-spin text-brand-500" />
                  ) : (
                    <Dialog.Close className="rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700">
                      <X className="h-4 w-4" />
                      <span className="sr-only">Close</span>
                    </Dialog.Close>
                  )}
                </div>

                <div className="mt-4">
                  <div className="h-2 overflow-hidden rounded-full bg-gray-100">
                    <div
                      className={`h-full rounded-full bg-brand-500 transition-all duration-300 ${mapOpsProgress.running && mapOpsProgress.currentStep === 0 ? 'animate-pulse' : ''}`}
                      style={{ width: `${mapOpsProgressPercent}%` }}
                    />
                  </div>
                  <div className="mt-2 flex items-center justify-between text-xs text-gray-500">
                    <span>
                      {mapOpsProgress.running ? '处理中' : '已完成'}
                    </span>
                    <span>
                      步骤 {Math.max(0, Math.min(mapOpsProgress.currentStep, mapOpsProgress.totalSteps))} / {mapOpsProgress.totalSteps}
                    </span>
                  </div>
                </div>

                {mapOpsProgress.oneKey ? (
                  <div className="mt-3 rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
                    <div className="text-[11px] font-medium text-gray-600">一键自动推进实时指标</div>
                    <div className="mt-1 space-y-0.5 text-[11px] text-gray-600">
                      <div>
                        作品批次：第 {mapOpsProgress.oneKey.bangumiBatch} 批，剩余作品 {formatMetricCount(mapOpsProgress.oneKey.bangumiRemaining)}
                      </div>
                      <div>
                        点位补队：累计 {mapOpsProgress.oneKey.pointBackfilledTotal}（新建 {mapOpsProgress.oneKey.pointBackfilledEnqueued} / 更新 {mapOpsProgress.oneKey.pointBackfilledUpdated}）
                      </div>
                      <div>
                        未完成点位：{formatMetricCount(mapOpsProgress.oneKey.pointUnfinishedTotal)}（已入队 {formatMetricCount(mapOpsProgress.oneKey.pointQueueOpen)} + 未入队估算 {formatMetricCount(mapOpsProgress.oneKey.pointUnqueuedEstimate)}）
                      </div>
                      <div>
                        翻译推进：本轮 {mapOpsProgress.oneKey.roundProcessed}，累计 {mapOpsProgress.oneKey.totalProcessed} / 预计总量 {formatMetricCount(mapOpsProgress.oneKey.estimatedTotal)}
                      </div>
                    </div>
                    <div className="mt-2">
                      <div className="h-2 overflow-hidden rounded-full bg-gray-200">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-brand-500 to-emerald-500 transition-all duration-300"
                          style={{ width: `${oneKeyProgressPercent}%` }}
                        />
                      </div>
                      <div className="mt-1 flex items-center justify-between text-[11px] text-gray-500">
                        <span>总推进完成度</span>
                        <span>
                          {oneKeyProgressPercent}%（{mapOpsProgress.oneKey.totalProcessed} / {formatMetricCount(mapOpsProgress.oneKey.estimatedTotal)}）
                        </span>
                      </div>
                    </div>
                  </div>
                ) : null}

                <div className="mt-4 grid grid-cols-5 gap-2 text-xs">
                  <div className="rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-center text-gray-600">
                    处理 {mapOpsProgress.processed}
                  </div>
                  <div className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-center text-emerald-700">
                    成功 {mapOpsProgress.success}
                  </div>
                  <div className="rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-center text-rose-700">
                    翻译失败 {mapOpsProgress.failed}
                  </div>
                  <div className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-center text-amber-700">
                    回收 {mapOpsProgress.reclaimed}
                  </div>
                  <div className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-center text-slate-600">
                    跳过 {mapOpsProgress.skipped}
                  </div>
                </div>

                {mapOpsProgress.errors.length > 0 ? (
                  <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2">
                    <div className="text-xs font-medium text-rose-700">失败原因</div>
                    <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-rose-700">
                      {mapOpsProgress.errors.slice(0, 4).map((message: string) => (
                        <li key={message} className="break-words">
                          {message}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {!mapOpsProgress.running ? (
                  <div className="mt-4 flex justify-end">
                    <Button variant="ghost" onClick={() => setMapOpsProgress(null)}>
                      关闭
                    </Button>
                  </div>
                ) : null}
              </>
            ) : null}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {view === 'tasks' ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-4">
            <div className="flex-1 min-w-[240px]">
              <label className="text-sm font-medium text-gray-700">搜索</label>
              <input
                value={q}
                onChange={(e) => {
                  setQ(e.target.value)
                  setPage(1)
                }}
                placeholder="标题 / slug / 任务ID / 实体ID"
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>

            <div className="min-w-[140px]">
              <label className="text-sm font-medium text-gray-700">类型</label>
              <select
                value={entityType}
                onChange={(e) => {
                  setEntityType(e.target.value)
                  setPage(1)
                }}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="all">全部</option>
                <option value="article">文章</option>
                <option value="city">城市</option>
                <option value="anime">动漫</option>
                <option value="anitabi_bangumi">地图作品</option>
                <option value="anitabi_point">地图地标</option>
              </select>
            </div>

            <div className="min-w-[140px]">
              <label className="text-sm font-medium text-gray-700">语言</label>
              <select
                value={targetLanguage}
                onChange={(e) => {
                  setTargetLanguage(e.target.value)
                  setPage(1)
                }}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="all">全部</option>
                <option value="en">English</option>
                <option value="ja">日本語</option>
              </select>
            </div>

            <div className="min-w-[140px]">
              <label className="text-sm font-medium text-gray-700">每页</label>
              <select
                value={String(pageSize)}
                onChange={(e) => {
                  setPageSize(clampInt(e.target.value, 20, { min: 5, max: 100 }))
                  setPage(1)
                }}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="20">20</option>
                <option value="50">50</option>
                <option value="100">100</option>
              </select>
            </div>

            <Button
              variant="ghost"
              className="h-10"
              onClick={() => {
                setStatus('ready')
                setEntityType('all')
                setTargetLanguage('all')
                setQ('')
                setPage(1)
                setPageSize(20)
              }}
            >
              重置
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {statusTabs.map((t: any) => {
              const count = stats ? stats[t.key] : null
              const isActive = status === t.key
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => {
                    setStatus(t.key)
                    setPage(1)
                  }}
                  className={
                    isActive
                      ? 'rounded-full bg-brand-500 px-3 py-1.5 text-sm text-white'
                      : 'rounded-full border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50'
                  }
                >
                  <span>{t.label}</span>
                  {statsLoading ? (
                    <span className="ml-2 text-xs opacity-80">…</span>
                  ) : count != null ? (
                    <span className="ml-2 rounded-full bg-white/20 px-2 py-0.5 text-xs">
                      {count}
                    </span>
                  ) : null}
                </button>
              )
            })}
          </div>

          {tasksError ? (
            <AdminErrorState message={tasksError} onRetry={() => void loadTasks()} />
          ) : null}

          {tasksLoading ? <AdminSkeleton rows={8} /> : null}

          {!tasksLoading && !tasksError ? (
            <div className="space-y-3">
              {tasks.length === 0 ? (
                <AdminEmptyState title="暂无匹配的翻译任务" />
              ) : (
                tasks.map((task: any) => {
                  const links = buildPublicLinks(task)
                  const canOpenTarget = task.status === 'approved' || Boolean(task.target)
                  const dateLabel =
                    task.status === 'approved' ? '更新' : task.status === 'ready' ? '生成' : '更新'

                  return (
                    <div
                      key={task.id}
                      className="rounded-lg border border-gray-200 bg-white p-4 hover:border-brand-300 transition-colors"
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded bg-blue-100 px-2 py-1 text-xs font-medium text-blue-700">
                              {entityTypeLabels[task.entityType] || task.entityType}
                            </span>
                            <span className="rounded bg-purple-100 px-2 py-1 text-xs font-medium text-purple-700">
                              {languageLabels[task.targetLanguage] || task.targetLanguage}
                            </span>
                            <span className="rounded bg-amber-100 px-2 py-1 text-xs font-medium text-amber-700">
                            {statusLabels[task.status] || task.status}
                          </span>
                          {task.target?.status ? (
                            <span className="rounded bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-700">
                              译文:{articleStatusLabels[task.target.status] || task.target.status}
                            </span>
                          ) : null}
                        </div>

                          <div className="mt-2">
                            <Link
                              href={`/admin/translations/${task.id}`}
                              className="block truncate text-base font-semibold text-gray-900 hover:underline"
                              title={task.subject.title || task.id}
                            >
                              {task.subject.title || '(未命名内容)'}
                            </Link>
                            {task.subject.subtitle ? (
                              <div className="mt-1 text-xs text-gray-500">{task.subject.subtitle}</div>
                            ) : null}
                          </div>

                          {task.target?.title ? (
                            <div className="mt-2 text-sm text-gray-700">
                              <span className="text-gray-500">译文标题：</span>
                              <span className="font-medium">{task.target.title}</span>
                            </div>
                          ) : null}

                          {task.error ? (
                            <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                              <strong>错误:</strong> {task.error}
                            </div>
                          ) : null}
                        </div>

                        <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
                          <div className="text-xs text-gray-500">
                            {dateLabel}：{formatDateTime(task.updatedAt || task.createdAt)}
                          </div>

                          <div className="flex flex-wrap items-center gap-2">
                            <Link
                              href={`/admin/translations/${task.id}`}
                              className={
                                task.status === 'ready'
                                  ? 'rounded-md bg-amber-500 px-3 py-1 text-sm text-white hover:bg-amber-600'
                                  : 'rounded-md bg-brand-500 px-3 py-1 text-sm text-white hover:bg-brand-600'
                              }
                            >
                              {task.status === 'ready' ? '审核' : '查看'}
                            </Link>

                            {links.source ? (
                              <a
                                href={links.source}
                                target="_blank"
                                rel="noreferrer"
                                className="rounded-md border border-gray-300 bg-white px-3 py-1 text-sm text-gray-700 hover:bg-gray-50"
                              >
                                原文
                              </a>
                            ) : null}

                            {canOpenTarget && links.target ? (
                              <a
                                href={links.target}
                                target="_blank"
                                rel="noreferrer"
                                className="rounded-md border border-gray-300 bg-white px-3 py-1 text-sm text-gray-700 hover:bg-gray-50"
                              >
                                译文
                              </a>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <div className="text-sm text-gray-600">
              共 {total} 条 <span className="text-gray-300 mx-1">|</span> 第 {page} / {totalPages} 页 <span className="text-gray-300 mx-1">|</span> 每页 {pageSize}
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                className="px-3 py-1.5"
                disabled={page <= 1 || tasksLoading}
                onClick={() => setPage((p: number) => Math.max(1, p - 1))}
              >
                上一页
              </Button>
              <Button
                variant="ghost"
                className="px-3 py-1.5"
                disabled={tasksLoading || page >= totalPages}
                onClick={() => setPage((p: number) => Math.min(totalPages, p + 1))}
              >
                下一页
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-4">
            <div className="flex-1 min-w-[240px]">
              <label className="text-sm font-medium text-gray-700">搜索标题</label>
              <input
                value={untranslatedQuery}
                onChange={(e) => {
                  setUntranslatedQuery(e.target.value)
                  setUntranslatedPage(1)
                }}
                placeholder="按标题筛选"
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
            <Button
              variant="ghost"
              className="h-10"
              onClick={() => {
                setUntranslatedQuery('')
                setUntranslatedPage(1)
                void loadUntranslated()
              }}
              disabled={untranslatedLoading}
            >
              刷新
            </Button>
          </div>

          {untranslatedLoading ? (
            <AdminSkeleton rows={8} />
          ) : untranslatedItems.length === 0 ? (
            <AdminEmptyState title="所有内容都已有翻译任务" />
          ) : (
            <div className="space-y-3">
              {untranslatedItems.map((item: any) => (
                <div
                  key={`${item.entityType}-${item.entityId}`}
                  className="rounded-lg border border-gray-200 bg-white p-4 hover:border-brand-300 transition-colors"
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded bg-blue-100 px-2 py-1 text-xs font-medium text-blue-700">
                          {entityTypeLabels[item.entityType] || item.entityType}
                        </span>
                        <span className="font-medium text-gray-900">{item.title}</span>
                        <div className="flex flex-wrap gap-1">
                          {item.missingLanguages.map((lang: string) => (
                            <span
                              key={lang}
                              className="rounded bg-red-100 px-2 py-1 text-xs font-medium text-red-700"
                            >
                              缺失: {languageLabels[lang] || lang}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="mt-1 text-xs text-gray-500">
                        {formatDateTime(item.date)}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
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

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <div className="text-sm text-gray-600">
              共 {untranslatedTotal} 条 <span className="text-gray-300 mx-1">|</span> 第 {untranslatedPage} / {Math.max(1, Math.ceil(untranslatedTotal / untranslatedPageSize))} 页
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                className="px-3 py-1.5"
                disabled={untranslatedLoading || untranslatedPage <= 1}
                onClick={() => setUntranslatedPage((p: number) => Math.max(1, p - 1))}
              >
                上一页
              </Button>
              <Button
                variant="ghost"
                className="px-3 py-1.5"
                disabled={untranslatedLoading || untranslatedPage >= Math.max(1, Math.ceil(untranslatedTotal / untranslatedPageSize))}
                onClick={() => setUntranslatedPage((p: number) => p + 1)}
              >
                下一页
              </Button>
            </div>
          </div>
        </div>
      )}

      <Dialog.Root open={showBatchModal} onOpenChange={setShowBatchModal}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 fade-in-0 animate-in" />
          <Dialog.Content className="fixed left-[50%] top-[50%] z-50 w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-white p-6 shadow-lg duration-200 animate-in fade-in-0 zoom-in-95 sm:rounded-lg">
            <div className="flex flex-col space-y-1.5 text-center sm:text-left">
              <Dialog.Title className="text-lg font-semibold leading-none tracking-tight">
                批量翻译
              </Dialog.Title>
              <Dialog.Description className="text-sm text-gray-500">
                选择已创建但未执行的翻译任务，然后一键执行翻译。
              </Dialog.Description>
            </div>
            
            <div className="space-y-3 py-4">
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="text-gray-600">
                  共 {batchTaskItems.length} 个待翻译任务，已选择 {batchSelectedIds.length} 个
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    className="h-8 px-3 text-xs"
                    onClick={toggleBatchSelectAll}
                    disabled={batchLoading || batchTaskItems.length === 0}
                  >
                    {batchSelectedIds.length === batchTaskItems.length ? '取消全选' : '全选'}
                  </Button>
                  <Button
                    variant="ghost"
                    className="h-8 px-3 text-xs"
                    onClick={() => setBatchSelectedIds([])}
                    disabled={batchLoading || batchSelectedIds.length === 0}
                  >
                    清空
                  </Button>
                </div>
              </div>

              {batchError ? (
                <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                  {batchError}
                </div>
              ) : null}

              {batchLoading ? (
                <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-6 text-center text-sm text-gray-500">
                  正在加载待翻译任务...
                </div>
              ) : batchTaskItems.length === 0 ? (
                <div className="rounded-md border border-green-200 bg-green-50 px-3 py-6 text-center text-sm text-green-700">
                  当前没有待执行翻译的任务
                </div>
              ) : (
                <div className="max-h-[360px] space-y-2 overflow-y-auto rounded-md border border-gray-200 p-2">
                  {batchTaskItems.map((task: any) => (
                    <label
                      key={task.id}
                      className="flex cursor-pointer items-start gap-3 rounded-md border border-gray-100 p-2 hover:bg-gray-50"
                    >
                      <input
                        type="checkbox"
                        className="mt-1 h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                        checked={batchSelectedIds.includes(task.id)}
                        onChange={() => toggleBatchItem(task.id)}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                            {entityTypeLabels[task.entityType] || task.entityType}
                          </span>
                          <span className="rounded bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700">
                            {languageLabels[task.targetLanguage] || task.targetLanguage}
                          </span>
                          <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                            {statusLabels[task.status] || task.status}
                          </span>
                        </div>
                        <div className="mt-1 truncate text-sm font-medium text-gray-900">
                          {task.subject.title || '(未命名内容)'}
                        </div>
                        <div className="mt-0.5 text-xs text-gray-500">
                          {task.subject.subtitle || `任务 ID: ${task.id}`}
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div className="flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2">
              <Button variant="ghost" onClick={() => setShowBatchModal(false)}>
                取消
              </Button>
              <Button 
                onClick={handleBatchSubmit} 
                disabled={batchLoading || batchExecuting || batchSelectedIds.length === 0}
              >
                {batchExecuting ? '执行中...' : '执行翻译'}
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
