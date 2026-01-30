import { PrismaCommentRepo } from './repoPrisma'
import { renderCommentMarkdown } from './markdown'
import type { CommentRepo } from './repo'

let cachedDeps: CommentApiDeps | null = null

export interface CommentApiDeps {
  repo: CommentRepo
  renderMarkdown: typeof renderCommentMarkdown
}

export function getCommentApiDeps(): CommentApiDeps {
  if (!cachedDeps) {
    cachedDeps = {
      repo: new PrismaCommentRepo(),
      renderMarkdown: renderCommentMarkdown
    }
  }
  return cachedDeps
}
