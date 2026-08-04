import type { Comment as PrismaComment, CommentReport as PrismaCommentReport } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import { isPrismaKnownRequestError } from '@/lib/db/prismaError'
import {
  DuplicateCommentReportError,
  type Comment,
  type CommentReport,
  type CommentRepo,
  type ModeratedComment,
} from './repo'

function toComment(record: PrismaComment): Comment {
  return {
    ...record,
    status: record.status === 'hidden' ? 'hidden' : 'visible',
  }
}

function toReport(record: PrismaCommentReport): CommentReport {
  return { ...record }
}

export class PrismaCommentRepo implements CommentRepo {
  async create(data: {
    articleId?: string | null
    mdxSlug?: string | null
    authorId: string
    parentId?: string | null
    content: string
    contentHtml: string
  }): Promise<Comment> {
    const created = await prisma.comment.create({
      data: {
        articleId: data.articleId || null,
        mdxSlug: data.mdxSlug || null,
        authorId: data.authorId,
        parentId: data.parentId || null,
        content: data.content,
        contentHtml: data.contentHtml,
      },
    })
    return toComment(created)
  }

  async findById(id: string): Promise<Comment | null> {
    const found = await prisma.comment.findUnique({ where: { id } })
    return found ? toComment(found) : null
  }

  async findByTarget(params: {
    articleId?: string
    mdxSlug?: string
  }): Promise<Comment[]> {
    const target = params.articleId
      ? { articleId: params.articleId }
      : params.mdxSlug
        ? { mdxSlug: params.mdxSlug }
        : null
    if (!target) return []

    const rows = await prisma.comment.findMany({
      where: { status: 'visible', ...target },
      orderBy: { createdAt: 'asc' },
    })
    return rows.map(toComment)
  }

  async listForModeration(): Promise<ModeratedComment[]> {
    const rows = await prisma.comment.findMany({
      include: {
        reports: { orderBy: { createdAt: 'asc' } },
      },
      orderBy: { createdAt: 'desc' },
    })
    return rows.map((row) => ({
      ...toComment(row),
      reports: row.reports.map(toReport),
    }))
  }

  async hide(id: string, hiddenBy: string): Promise<Comment | null> {
    const existing = await prisma.comment.findUnique({ where: { id }, select: { id: true } })
    if (!existing) return null

    const updated = await prisma.comment.update({
      where: { id },
      data: { status: 'hidden', hiddenAt: new Date(), hiddenBy },
    })
    return toComment(updated)
  }

  async restore(id: string): Promise<Comment | null> {
    const existing = await prisma.comment.findUnique({ where: { id }, select: { id: true } })
    if (!existing) return null

    const updated = await prisma.comment.update({
      where: { id },
      data: { status: 'visible', hiddenAt: null, hiddenBy: null },
    })
    return toComment(updated)
  }

  async createReport(data: {
    commentId: string
    reporterId: string
    reason: string
  }): Promise<CommentReport> {
    try {
      const created = await prisma.commentReport.create({ data })
      return toReport(created)
    } catch (err) {
      if (isPrismaKnownRequestError(err) && err.code === 'P2002') {
        throw new DuplicateCommentReportError()
      }
      throw err
    }
  }

  async findReport(commentId: string, reporterId: string): Promise<CommentReport | null> {
    const found = await prisma.commentReport.findUnique({
      where: { commentId_reporterId: { commentId, reporterId } },
    })
    return found ? toReport(found) : null
  }

  async delete(id: string): Promise<void> {
    await prisma.comment.delete({ where: { id } })
  }

  async toggleLike(commentId: string, userId: string): Promise<{
    liked: boolean
    count: number
  }> {
    const existing = await prisma.commentLike.findUnique({
      where: {
        userId_commentId: { userId, commentId },
      },
    })

    if (existing) {
      await prisma.commentLike.delete({
        where: {
          userId_commentId: { userId, commentId },
        },
      })
      const count = await prisma.commentLike.count({
        where: { commentId },
      })
      return { liked: false, count }
    } else {
      await prisma.commentLike.create({
        data: { userId, commentId },
      })
      const count = await prisma.commentLike.count({
        where: { commentId },
      })
      return { liked: true, count }
    }
  }

  async getLikeStatus(commentId: string, userId: string): Promise<boolean> {
    const like = await prisma.commentLike.findUnique({
      where: {
        userId_commentId: { userId, commentId },
      },
    })
    return !!like
  }

  async getLikeCount(commentId: string): Promise<number> {
    return prisma.commentLike.count({
      where: { commentId },
    })
  }
}
