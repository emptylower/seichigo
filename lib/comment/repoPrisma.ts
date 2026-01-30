import type { Comment, CommentRepo } from './repo'
import { prisma } from '@/lib/db/prisma'

export class PrismaCommentRepo implements CommentRepo {
  async create(data: {
    articleId?: string | null
    mdxSlug?: string | null
    authorId: string
    parentId?: string | null
    content: string
    contentHtml: string
  }): Promise<Comment> {
    return (prisma as any).comment.create({
      data: {
        articleId: data.articleId || null,
        mdxSlug: data.mdxSlug || null,
        authorId: data.authorId,
        parentId: data.parentId || null,
        content: data.content,
        contentHtml: data.contentHtml,
      },
    })
  }

  async findById(id: string): Promise<Comment | null> {
    return (prisma as any).comment.findUnique({
      where: { id },
    })
  }

  async findByTarget(params: {
    articleId?: string
    mdxSlug?: string
  }): Promise<Comment[]> {
    return (prisma as any).comment.findMany({
      where: {
        OR: [
          params.articleId ? { articleId: params.articleId } : undefined,
          params.mdxSlug ? { mdxSlug: params.mdxSlug } : undefined,
        ].filter(Boolean),
      },
      orderBy: { createdAt: 'asc' },
    })
  }

  async delete(id: string): Promise<void> {
    await (prisma as any).comment.delete({
      where: { id },
    })
  }

  async toggleLike(commentId: string, userId: string): Promise<{
    liked: boolean
    count: number
  }> {
    const existing = await (prisma as any).commentLike.findUnique({
      where: {
        userId_commentId: { userId, commentId },
      },
    })

    if (existing) {
      await (prisma as any).commentLike.delete({
        where: {
          userId_commentId: { userId, commentId },
        },
      })
      const count = await (prisma as any).commentLike.count({
        where: { commentId },
      })
      return { liked: false, count }
    } else {
      await (prisma as any).commentLike.create({
        data: { userId, commentId },
      })
      const count = await (prisma as any).commentLike.count({
        where: { commentId },
      })
      return { liked: true, count }
    }
  }

  async getLikeStatus(commentId: string, userId: string): Promise<boolean> {
    const like = await (prisma as any).commentLike.findUnique({
      where: {
        userId_commentId: { userId, commentId },
      },
    })
    return !!like
  }

  async getLikeCount(commentId: string): Promise<number> {
    return (prisma as any).commentLike.count({
      where: { commentId },
    })
  }
}
