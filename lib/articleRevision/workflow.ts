export type ArticleRevisionStatus = 'draft' | 'in_review' | 'rejected' | 'approved'

export type Actor = {
  userId: string
  isAdmin: boolean
}

export type ArticleRevisionState = {
  status: ArticleRevisionStatus
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

export function isRevisionAuthor(revision: Pick<ArticleRevisionState, 'authorId'>, actor: Actor): boolean {
  return revision.authorId === actor.userId
}

export function isAdmin(actor: Actor): boolean {
  return actor.isAdmin
}

export function canEditRevision(revision: ArticleRevisionState, actor: Actor): boolean {
  if (!isRevisionAuthor(revision, actor)) return false
  return revision.status === 'draft' || revision.status === 'rejected'
}

export function canSubmitRevision(revision: ArticleRevisionState, actor: Actor): boolean {
  return canEditRevision(revision, actor)
}

export function canWithdrawRevision(revision: ArticleRevisionState, actor: Actor): boolean {
  return isRevisionAuthor(revision, actor) && revision.status === 'in_review'
}

export function canApproveRevision(revision: ArticleRevisionState, actor: Actor): boolean {
  return isAdmin(actor) && revision.status === 'in_review'
}

export function canRejectRevision(revision: ArticleRevisionState, actor: Actor): boolean {
  return isAdmin(actor) && revision.status === 'in_review'
}

export function submitRevision(revision: ArticleRevisionState, actor: Actor): WorkflowResult<ArticleRevisionState> {
  if (!isRevisionAuthor(revision, actor)) return err('FORBIDDEN', '无权限')
  if (revision.status !== 'draft' && revision.status !== 'rejected') return err('INVALID_STATUS', '状态不允许提交审核')
  return ok({ ...revision, status: 'in_review', rejectReason: null })
}

export function withdrawRevision(revision: ArticleRevisionState, actor: Actor): WorkflowResult<ArticleRevisionState> {
  if (!isRevisionAuthor(revision, actor)) return err('FORBIDDEN', '无权限')
  if (revision.status !== 'in_review') return err('INVALID_STATUS', '当前状态不可撤回')
  return ok({ ...revision, status: 'draft' })
}

export function approveRevision(revision: ArticleRevisionState, actor: Actor): WorkflowResult<ArticleRevisionState> {
  if (!isAdmin(actor)) return err('FORBIDDEN', '无权限')
  if (revision.status !== 'in_review') return err('INVALID_STATUS', '当前状态不可同意更新')
  return ok({ ...revision, status: 'approved', rejectReason: null })
}

export function rejectRevision(revision: ArticleRevisionState, actor: Actor, reason: string): WorkflowResult<ArticleRevisionState> {
  if (!isAdmin(actor)) return err('FORBIDDEN', '无权限')
  if (revision.status !== 'in_review') return err('INVALID_STATUS', '当前状态不可拒绝')
  const cleaned = reason.trim()
  if (!cleaned) return err('MISSING_REASON', '必须填写拒绝原因')
  return ok({ ...revision, status: 'rejected', rejectReason: cleaned })
}

