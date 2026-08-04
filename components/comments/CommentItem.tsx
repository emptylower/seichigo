'use client'

import { useState } from 'react'
import { Flag } from 'lucide-react'
import CommentForm from './CommentForm'
import CommentList from './CommentList'
import type { CommentItemData, CommentReportHandler } from './types'
import { COMMENT_REPORT_REASON_LABELS, COMMENT_REPORT_REASONS, type CommentReportReason } from '@/lib/comment/reasons'

type Props = {
  comment: CommentItemData
  onReply: (content: string, parentId: string) => Promise<boolean>
  onDelete: () => void
  currentUserId?: string
  isAdmin?: boolean
  onReport: CommentReportHandler
}

export default function CommentItem({ comment, onReply, onDelete, currentUserId, isAdmin, onReport }: Props) {
  const [showReplyForm, setShowReplyForm] = useState(false)
  const [showReportForm, setShowReportForm] = useState(false)
  const [reportReason, setReportReason] = useState<CommentReportReason>('spam')
  const [reporting, setReporting] = useState(false)
  const [reportError, setReportError] = useState<string | null>(null)
  const [liked, setLiked] = useState(false)
  const [likeCount, setLikeCount] = useState(comment.likeCount)
  
  const canDelete = currentUserId === comment.authorId || isAdmin
  
  async function handleLike() {
    const res = await fetch(`/api/comments/${comment.id}/like`, { method: 'POST' })
    const data = await res.json()
    if (data.ok) {
      setLiked(data.liked)
      setLikeCount(data.count)
    }
  }
  
  async function handleDelete() {
    if (!confirm('确定删除此评论？')) return
    const res = await fetch(`/api/comments/${comment.id}`, { method: 'DELETE' })
    if (res.ok) onDelete()
  }
  
  async function handleReplySubmit(content: string) {
    const success = await onReply(content, comment.id)
    if (success) setShowReplyForm(false)
    return success
  }

  async function handleReport() {
    setReporting(true)
    setReportError(null)
    const result = await onReport(comment.id, reportReason)
    if (result.ok) {
      setShowReportForm(false)
    } else {
      setReportError(result.error || '举报失败，请重试')
    }
    setReporting(false)
  }
  
  return (
    <div className="border-l-2 border-gray-200 pl-4">
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <span className="font-medium">{comment.author.id}</span>
            <span>·</span>
            <span>{new Date(comment.createdAt).toLocaleString('zh-CN')}</span>
          </div>
          
          <div 
            className="prose prose-sm mt-2"
            dangerouslySetInnerHTML={{ __html: comment.contentHtml }}
          />
          
          <div className="flex items-center gap-4 mt-2 text-sm">
            <button onClick={handleLike} className="text-gray-600 hover:text-pink-600">
              {liked ? '❤️' : '🤍'} {likeCount}
            </button>
            
            {currentUserId && (
              <button onClick={() => setShowReplyForm(!showReplyForm)} className="text-gray-600 hover:text-pink-600">
                回复
              </button>
            )}

            {currentUserId && (
              <button
                type="button"
                onClick={() => {
                  setShowReportForm((visible) => !visible)
                  setReportError(null)
                }}
                className="inline-flex items-center gap-1 text-gray-600 hover:text-amber-600"
                aria-expanded={showReportForm}
              >
                <Flag className="h-3.5 w-3.5" aria-hidden="true" />
                举报
              </button>
            )}
            
            {canDelete && (
              <button onClick={handleDelete} className="text-red-600 hover:text-red-700">
                删除
              </button>
            )}
          </div>

          {showReportForm && currentUserId && (
            <div className="mt-3 flex flex-wrap items-end gap-2 rounded-md border border-gray-200 bg-gray-50 p-3">
              <label className="flex min-w-48 flex-1 flex-col gap-1 text-xs text-gray-600" htmlFor={`report-reason-${comment.id}`}>
                举报原因
                <select
                  id={`report-reason-${comment.id}`}
                  value={reportReason}
                  onChange={(event) => setReportReason(event.target.value as CommentReportReason)}
                  disabled={reporting}
                  className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-800"
                >
                  {COMMENT_REPORT_REASONS.map((reason) => (
                    <option key={reason} value={reason}>
                      {COMMENT_REPORT_REASON_LABELS[reason]}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={() => void handleReport()}
                disabled={reporting}
                className="rounded-md bg-gray-900 px-3 py-1.5 text-sm text-white hover:bg-gray-700 disabled:opacity-50"
              >
                {reporting ? '提交中...' : '提交举报'}
              </button>
              <button
                type="button"
                onClick={() => setShowReportForm(false)}
                disabled={reporting}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-white disabled:opacity-50"
              >
                取消
              </button>
              {reportError && <p className="basis-full text-sm text-red-600">{reportError}</p>}
            </div>
          )}
          
          {showReplyForm && (
            <div className="mt-3">
              <CommentForm 
                onSubmit={handleReplySubmit}
                placeholder="写下你的回复..."
                submitText="回复"
              />
            </div>
          )}
          
          {comment.replies.length > 0 && (
            <div className="mt-4">
              <CommentList
                comments={comment.replies}
                onReply={onReply}
                onDelete={onDelete}
                currentUserId={currentUserId}
                isAdmin={isAdmin}
                onReport={onReport}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
