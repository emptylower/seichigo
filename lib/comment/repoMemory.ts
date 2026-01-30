import type { Comment, CommentRepo } from './repo'

type Options = {
  now?: () => Date
}

export class InMemoryCommentRepo implements CommentRepo {
  private readonly now: () => Date
  private comments = new Map<string, Comment>()
  private likes = new Map<string, Set<string>>()

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
        if (params.articleId) return c.articleId === params.articleId
        if (params.mdxSlug) return c.mdxSlug === params.mdxSlug
        return false
      })
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
  }

  async delete(id: string): Promise<void> {
    const replies = Array.from(this.comments.values()).filter(
      (c) => c.parentId === id
    )
    for (const reply of replies) {
      await this.delete(reply.id)
    }

    this.likes.delete(id)
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
