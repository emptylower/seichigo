import type { CommentApiDeps } from '../api'

export function createHandlers(deps: CommentApiDeps) {
  const { repo } = deps

  return {
    async toggle(session: any, commentId: string) {
      try {
        if (!session?.user?.id) {
          return { ok: false as const, error: '请先登录' }
        }

        const result = await repo.toggleLike(commentId, session.user.id)

        return { ok: true as const, liked: result.liked, count: result.count }
      } catch (err) {
        console.error('[comment handler]', err)
        return { ok: false as const, error: '服务器错误' }
      }
    }
  }
}
