export type CommentStatus = 'visible' | 'hidden'

export type Comment = {
  id: string
  articleId: string | null
  mdxSlug: string | null
  authorId: string
  parentId: string | null
  content: string
  contentHtml: string
  status: CommentStatus
  hiddenAt: Date | null
  hiddenBy: string | null
  createdAt: Date
}

export type CommentReport = {
  id: string
  commentId: string
  reporterId: string
  reason: string
  createdAt: Date
}

export type ModeratedComment = Comment & {
  reports: CommentReport[]
}

export class DuplicateCommentReportError extends Error {
  constructor() {
    super('comment report already exists')
    this.name = 'DuplicateCommentReportError'
  }
}

export type CommentRepo = {
  create(data: {
    articleId?: string | null
    mdxSlug?: string | null
    authorId: string
    parentId?: string | null
    content: string
    contentHtml: string
  }): Promise<Comment>

  findById(id: string): Promise<Comment | null>

  findByTarget(params: {
    articleId?: string
    mdxSlug?: string
  }): Promise<Comment[]>

  listForModeration(): Promise<ModeratedComment[]>

  hide(id: string, hiddenBy: string): Promise<Comment | null>

  restore(id: string): Promise<Comment | null>

  createReport(data: {
    commentId: string
    reporterId: string
    reason: string
  }): Promise<CommentReport>

  findReport(commentId: string, reporterId: string): Promise<CommentReport | null>

  delete(id: string): Promise<void>

  toggleLike(commentId: string, userId: string): Promise<{
    liked: boolean
    count: number
  }>

  getLikeStatus(commentId: string, userId: string): Promise<boolean>

  getLikeCount(commentId: string): Promise<number>
}
