export type ArticleStatus = 'draft' | 'in_review' | 'rejected' | 'published'

export type Actor = {
  userId: string
  isAdmin: boolean
}

export type ArticleState = {
  status: ArticleStatus
  authorId: string
  rejectReason?: string | null
}

export type WorkflowErrorCode = 'FORBIDDEN' | 'INVALID_STATUS' | 'MISSING_REASON'

export type WorkflowError = {
  code: WorkflowErrorCode
  message: string
}

export type WorkflowResult<T> = { ok: true; value: T } | { ok: false; error: WorkflowError }

function ok<T>(value: T): WorkflowResult<T> {
  return { ok: true, value }
}

function err(code: WorkflowErrorCode, message: string): WorkflowResult<never> {
  return { ok: false, error: { code, message } }
}

export function isAuthor(article: Pick<ArticleState, 'authorId'>, actor: Actor): boolean {
  return article.authorId === actor.userId
}

export function isAdmin(actor: Actor): boolean {
  return actor.isAdmin
}

export function canEdit(article: ArticleState, actor: Actor): boolean {
  if (!isAuthor(article, actor)) return false
  return article.status === 'draft' || article.status === 'rejected'
}

export function canSubmit(article: ArticleState, actor: Actor): boolean {
  return canEdit(article, actor)
}

export function canWithdraw(article: ArticleState, actor: Actor): boolean {
  return isAuthor(article, actor) && article.status === 'in_review'
}

export function canApprove(article: ArticleState, actor: Actor): boolean {
  return isAdmin(actor) && article.status === 'in_review'
}

export function canReject(article: ArticleState, actor: Actor): boolean {
  return isAdmin(actor) && article.status === 'in_review'
}

export function canUnpublish(article: ArticleState, actor: Actor): boolean {
  return isAdmin(actor) && article.status === 'published'
}

export function submit(article: ArticleState, actor: Actor): WorkflowResult<ArticleState> {
  if (!isAuthor(article, actor)) return err('FORBIDDEN', '无权限')
  if (article.status !== 'draft' && article.status !== 'rejected') return err('INVALID_STATUS', '状态不允许提交审核')
  return ok({ ...article, status: 'in_review', rejectReason: null })
}

export function withdraw(article: ArticleState, actor: Actor): WorkflowResult<ArticleState> {
  if (!isAuthor(article, actor)) return err('FORBIDDEN', '无权限')
  if (article.status !== 'in_review') return err('INVALID_STATUS', '当前状态不可撤回')
  return ok({ ...article, status: 'draft' })
}

export function approve(article: ArticleState, actor: Actor): WorkflowResult<ArticleState> {
  if (!isAdmin(actor)) return err('FORBIDDEN', '无权限')
  if (article.status !== 'in_review') return err('INVALID_STATUS', '当前状态不可同意发布')
  return ok({ ...article, status: 'published', rejectReason: null })
}

export function reject(article: ArticleState, actor: Actor, reason: string): WorkflowResult<ArticleState> {
  if (!isAdmin(actor)) return err('FORBIDDEN', '无权限')
  if (article.status !== 'in_review') return err('INVALID_STATUS', '当前状态不可拒绝')
  const cleaned = reason.trim()
  if (!cleaned) return err('MISSING_REASON', '必须填写拒绝原因')
  return ok({ ...article, status: 'rejected', rejectReason: cleaned })
}

export function unpublish(article: ArticleState, actor: Actor, reason: string): WorkflowResult<ArticleState> {
  if (!isAdmin(actor)) return err('FORBIDDEN', '无权限')
  if (article.status !== 'published') return err('INVALID_STATUS', '当前状态不可下架')
  const cleaned = reason.trim()
  if (!cleaned) return err('MISSING_REASON', '必须填写下架原因')
  return ok({ ...article, status: 'rejected', rejectReason: cleaned })
}
