import type { CommentApiDeps } from '../api'

export function createHandlers(deps: CommentApiDeps) {
  const { repo } = deps

  return {
    async remove(session: any, commentId: string) {
      try {
        if (!session?.user?.id) {
          return { ok: false as const, error: '请先登录' }
        }

        const comment = await repo.findById(commentId)
        if (!comment) {
          return { ok: false as const, error: '评论不存在' }
        }

        const isAuthor = comment.authorId === session.user.id
        const isAdmin = Boolean(session.user.isAdmin)

        if (!isAuthor && !isAdmin) {
          return { ok: false as const, error: '无权限' }
        }

        await repo.delete(commentId)

        return { ok: true as const }
      } catch (err) {
        console.error('[comment handler]', err)
        return { ok: false as const, error: '服务器错误' }
      }
    }
  }
}
