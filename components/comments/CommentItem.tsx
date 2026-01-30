'use client'

import { useState } from 'react'
import CommentForm from './CommentForm'
import CommentList from './CommentList'

type Comment = {
  id: string
  authorId: string
  content: string
  contentHtml: string
  createdAt: string
  likeCount: number
  author: { id: string }
  replies: Comment[]
}

type Props = {
  comment: Comment
  onReply: (content: string, parentId: string) => Promise<boolean>
  onDelete: () => void
  currentUserId?: string
  isAdmin?: boolean
}

export default function CommentItem({ comment, onReply, onDelete, currentUserId, isAdmin }: Props) {
  const [showReplyForm, setShowReplyForm] = useState(false)
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
            
            {canDelete && (
              <button onClick={handleDelete} className="text-red-600 hover:text-red-700">
                删除
              </button>
            )}
          </div>
          
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
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
