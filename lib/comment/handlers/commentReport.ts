import type { CommentApiDeps } from '../api'
import { isCommentReportReason } from '../reasons'
import { DuplicateCommentReportError } from '../repo'

type CommentSession = {
  user?: {
    id?: string
  }
} | null

export function createHandlers(deps: CommentApiDeps) {
  const { repo } = deps

  return {
    async report(session: CommentSession, commentId: string, reason: unknown) {
      try {
        const reporterId = session?.user?.id
        if (!reporterId) {
          return { ok: false as const, error: '请先登录' }
        }

        if (!isCommentReportReason(reason)) {
          return { ok: false as const, error: '举报原因无效' }
        }

        const id = commentId.trim()
        const comment = await repo.findById(id)
        if (!comment) {
          return { ok: false as const, error: '评论不存在' }
        }

        const existing = await repo.findReport(id, reporterId)
        if (existing) {
          return { ok: false as const, error: '你已经举报过该评论' }
        }

        const report = await repo.createReport({ commentId: id, reporterId, reason })
        return { ok: true as const, report }
      } catch (err) {
        if (err instanceof DuplicateCommentReportError) {
          return { ok: false as const, error: '你已经举报过该评论' }
        }
        console.error('[comment report handler]', err)
        return { ok: false as const, error: '服务器错误' }
      }
    },
  }
}
