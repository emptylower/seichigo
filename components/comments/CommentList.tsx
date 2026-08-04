'use client'

import CommentItem from './CommentItem'
import type { CommentItemData, CommentReportHandler } from './types'

type Props = {
  comments: CommentItemData[]
  onReply: (content: string, parentId: string) => Promise<boolean>
  onDelete: () => void
  currentUserId?: string
  isAdmin?: boolean
  onReport: CommentReportHandler
}

export default function CommentList({ comments, onReply, onDelete, currentUserId, isAdmin, onReport }: Props) {
  if (comments.length === 0) {
    return <p className="text-gray-500 mt-4">暂无评论</p>
  }
  
  return (
    <div className="space-y-4 mt-6">
      {comments.map(comment => (
        <CommentItem
          key={comment.id}
          comment={comment}
          onReply={onReply}
          onDelete={onDelete}
          currentUserId={currentUserId}
          isAdmin={isAdmin}
          onReport={onReport}
        />
      ))}
    </div>
  )
}
