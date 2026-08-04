import { isAdminSession } from '@/lib/admin/handlers/common'
import type { CommentApiDeps } from '../api'

type ModerationSession = {
  user?: {
    id?: string
    isAdmin?: boolean
  }
} | null

export function createHandlers(deps: CommentApiDeps) {
  const { repo } = deps

  function requireAdmin(session: ModerationSession) {
    if (!isAdminSession(session) || !session?.user?.id) {
      return { ok: false as const, error: '无权限' }
    }
    return { ok: true as const, adminId: session.user.id }
  }

  return {
    async list(session: ModerationSession) {
      const auth = requireAdmin(session)
      if (!auth.ok) return auth

      try {
        const comments = await repo.listForModeration()
        return { ok: true as const, comments }
      } catch (err) {
        console.error('[comment moderation handler]', err)
        return { ok: false as const, error: '服务器错误' }
      }
    },

    async update(session: ModerationSession, commentId: string, action: unknown) {
      const auth = requireAdmin(session)
      if (!auth.ok) return auth
      if (action !== 'hide' && action !== 'restore') {
        return { ok: false as const, error: '操作无效' }
      }

      try {
        const id = commentId.trim()
        const comment = action === 'hide'
          ? await repo.hide(id, auth.adminId)
          : await repo.restore(id)
        if (!comment) {
          return { ok: false as const, error: '评论不存在' }
        }
        return { ok: true as const, comment }
      } catch (err) {
        console.error('[comment moderation handler]', err)
        return { ok: false as const, error: '服务器错误' }
      }
    },

    async remove(session: ModerationSession, commentId: string) {
      const auth = requireAdmin(session)
      if (!auth.ok) return auth

      try {
        const id = commentId.trim()
        const comment = await repo.findById(id)
        if (!comment) {
          return { ok: false as const, error: '评论不存在' }
        }
        await repo.delete(id)
        return { ok: true as const }
      } catch (err) {
        console.error('[comment moderation handler]', err)
        return { ok: false as const, error: '服务器错误' }
      }
    },
  }
}
