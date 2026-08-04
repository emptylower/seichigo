import {
  DuplicateCommentReportError,
  type Comment,
  type CommentReport,
  type CommentRepo,
  type ModeratedComment,
} from './repo'

type Options = {
  now?: () => Date
}

export class InMemoryCommentRepo implements CommentRepo {
  private readonly now: () => Date
  private comments = new Map<string, Comment>()
  private likes = new Map<string, Set<string>>()
  private reports = new Map<string, CommentReport>()

  constructor(options?: Options) {
    this.now = options?.now ?? (() => new Date())
  }

  async create(data: {
    articleId?: string | null
    mdxSlug?: string | null
    authorId: string
    parentId?: string | null
    content: string
    contentHtml: string
  }): Promise<Comment> {
    const comment: Comment = {
      id: Math.random().toString(36).slice(2),
      articleId: data.articleId ?? null,
      mdxSlug: data.mdxSlug ?? null,
      authorId: data.authorId,
      parentId: data.parentId ?? null,
      content: data.content,
      contentHtml: data.contentHtml,
      status: 'visible',
      hiddenAt: null,
      hiddenBy: null,
      createdAt: this.now(),
    }
    this.comments.set(comment.id, comment)
    return comment
  }

  async findById(id: string): Promise<Comment | null> {
    return this.comments.get(id) ?? null
  }

  async findByTarget(params: {
    articleId?: string
    mdxSlug?: string
  }): Promise<Comment[]> {
    const allComments = Array.from(this.comments.values())
    return allComments
      .filter((c) => {
        if (c.status !== 'visible') return false
        if (params.articleId) return c.articleId === params.articleId
        if (params.mdxSlug) return c.mdxSlug === params.mdxSlug
        return false
      })
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
  }

  async listForModeration(): Promise<ModeratedComment[]> {
    return Array.from(this.comments.values())
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((comment) => ({
        ...comment,
        reports: Array.from(this.reports.values())
          .filter((report) => report.commentId === comment.id)
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
      }))
  }

  async hide(id: string, hiddenBy: string): Promise<Comment | null> {
    const comment = this.comments.get(id)
    if (!comment) return null

    const updated: Comment = {
      ...comment,
      status: 'hidden',
      hiddenAt: this.now(),
      hiddenBy,
    }
    this.comments.set(id, updated)
    return updated
  }

  async restore(id: string): Promise<Comment | null> {
    const comment = this.comments.get(id)
    if (!comment) return null

    const updated: Comment = {
      ...comment,
      status: 'visible',
      hiddenAt: null,
      hiddenBy: null,
    }
    this.comments.set(id, updated)
    return updated
  }

  async createReport(data: {
    commentId: string
    reporterId: string
    reason: string
  }): Promise<CommentReport> {
    if (!this.comments.has(data.commentId)) throw new Error('Comment not found')

    const existing = await this.findReport(data.commentId, data.reporterId)
    if (existing) throw new DuplicateCommentReportError()

    const report: CommentReport = {
      id: Math.random().toString(36).slice(2),
      commentId: data.commentId,
      reporterId: data.reporterId,
      reason: data.reason,
      createdAt: this.now(),
    }
    this.reports.set(report.id, report)
    return report
  }

  async findReport(commentId: string, reporterId: string): Promise<CommentReport | null> {
    return Array.from(this.reports.values()).find(
      (report) => report.commentId === commentId && report.reporterId === reporterId
    ) ?? null
  }

  async delete(id: string): Promise<void> {
    const replies = Array.from(this.comments.values()).filter(
      (c) => c.parentId === id
    )
    for (const reply of replies) {
      await this.delete(reply.id)
    }

    this.likes.delete(id)
    for (const [reportId, report] of this.reports) {
      if (report.commentId === id) this.reports.delete(reportId)
    }
    this.comments.delete(id)
  }

  async toggleLike(
    commentId: string,
    userId: string
  ): Promise<{ liked: boolean; count: number }> {
    if (!this.likes.has(commentId)) {
      this.likes.set(commentId, new Set())
    }
    const likeSet = this.likes.get(commentId)!

    if (likeSet.has(userId)) {
      likeSet.delete(userId)
      return { liked: false, count: likeSet.size }
    } else {
      likeSet.add(userId)
      return { liked: true, count: likeSet.size }
    }
  }

  async getLikeStatus(commentId: string, userId: string): Promise<boolean> {
    return this.likes.get(commentId)?.has(userId) ?? false
  }

  async getLikeCount(commentId: string): Promise<number> {
    return this.likes.get(commentId)?.size ?? 0
  }
}
