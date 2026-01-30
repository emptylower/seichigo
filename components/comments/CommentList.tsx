'use client'

import CommentItem from './CommentItem'

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
  comments: Comment[]
  onReply: (content: string, parentId: string) => Promise<boolean>
  onDelete: () => void
  currentUserId?: string
  isAdmin?: boolean
}

export default function CommentList({ comments, onReply, onDelete, currentUserId, isAdmin }: Props) {
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
        />
      ))}
    </div>
  )
}
