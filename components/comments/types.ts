import type { CommentReportReason } from '@/lib/comment/reasons'

export type CommentItemData = {
  id: string
  authorId: string
  content: string
  contentHtml: string
  createdAt: string
  likeCount: number
  author: { id: string }
  replies: CommentItemData[]
}

export type CommentReportResult = {
  ok: boolean
  error?: string
}

export type CommentReportHandler = (
  commentId: string,
  reason: CommentReportReason
) => Promise<CommentReportResult>
