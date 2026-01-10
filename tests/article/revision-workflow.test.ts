import { describe, expect, it } from 'vitest'
import {
  approveRevision,
  canEditRevision,
  rejectRevision,
  submitRevision,
  withdrawRevision,
  type Actor,
  type ArticleRevisionState,
} from '@/lib/articleRevision/workflow'

const author: Actor = { userId: 'user-1', isAdmin: false }
const otherUser: Actor = { userId: 'user-2', isAdmin: false }
const admin: Actor = { userId: 'admin-1', isAdmin: true }

function revision(status: ArticleRevisionState['status'], authorId: string = author.userId): ArticleRevisionState {
  return { status, authorId }
}

describe('article revision workflow', () => {
  it('author can edit draft/rejected; cannot edit in_review/approved', () => {
    expect(canEditRevision(revision('draft'), author)).toBe(true)
    expect(canEditRevision({ ...revision('rejected'), rejectReason: 'needs changes' }, author)).toBe(true)

    expect(canEditRevision(revision('in_review'), author)).toBe(false)
    expect(canEditRevision(revision('approved'), author)).toBe(false)
  })

  it('non-author cannot edit', () => {
    expect(canEditRevision(revision('draft'), otherUser)).toBe(false)
    expect(canEditRevision(revision('rejected'), otherUser)).toBe(false)
  })

  it('submit: draft|rejected -> in_review (author only)', () => {
    const r1 = submitRevision(revision('draft'), author)
    expect(r1.ok).toBe(true)
    if (r1.ok) expect(r1.value.status).toBe('in_review')

    const r2 = submitRevision({ ...revision('rejected'), rejectReason: 'bad' }, author)
    expect(r2.ok).toBe(true)
    if (r2.ok) {
      expect(r2.value.status).toBe('in_review')
      expect(r2.value.rejectReason ?? null).toBe(null)
    }

    const r3 = submitRevision(revision('in_review'), author)
    expect(r3.ok).toBe(false)
    if (!r3.ok) expect(r3.error.code).toBe('INVALID_STATUS')

    const r4 = submitRevision(revision('draft'), otherUser)
    expect(r4.ok).toBe(false)
    if (!r4.ok) expect(r4.error.code).toBe('FORBIDDEN')
  })

  it('withdraw: in_review -> draft (author only)', () => {
    const r1 = withdrawRevision(revision('in_review'), author)
    expect(r1.ok).toBe(true)
    if (r1.ok) expect(r1.value.status).toBe('draft')

    const r2 = withdrawRevision(revision('draft'), author)
    expect(r2.ok).toBe(false)
    if (!r2.ok) expect(r2.error.code).toBe('INVALID_STATUS')

    const r3 = withdrawRevision(revision('in_review'), otherUser)
    expect(r3.ok).toBe(false)
    if (!r3.ok) expect(r3.error.code).toBe('FORBIDDEN')
  })

  it('approve: in_review -> approved (admin only)', () => {
    const r1 = approveRevision(revision('in_review'), admin)
    expect(r1.ok).toBe(true)
    if (r1.ok) expect(r1.value.status).toBe('approved')

    const r2 = approveRevision(revision('draft'), admin)
    expect(r2.ok).toBe(false)
    if (!r2.ok) expect(r2.error.code).toBe('INVALID_STATUS')

    const r3 = approveRevision(revision('in_review'), author)
    expect(r3.ok).toBe(false)
    if (!r3.ok) expect(r3.error.code).toBe('FORBIDDEN')
  })

  it('reject: in_review -> rejected with reason (admin only)', () => {
    const r1 = rejectRevision(revision('in_review'), admin, ' needs more detail ')
    expect(r1.ok).toBe(true)
    if (r1.ok) {
      expect(r1.value.status).toBe('rejected')
      expect(r1.value.rejectReason).toBe('needs more detail')
    }

    const r2 = rejectRevision(revision('in_review'), admin, '')
    expect(r2.ok).toBe(false)
    if (!r2.ok) expect(r2.error.code).toBe('MISSING_REASON')

    const r3 = rejectRevision(revision('draft'), admin, 'x')
    expect(r3.ok).toBe(false)
    if (!r3.ok) expect(r3.error.code).toBe('INVALID_STATUS')

    const r4 = rejectRevision(revision('in_review'), author, 'x')
    expect(r4.ok).toBe(false)
    if (!r4.ok) expect(r4.error.code).toBe('FORBIDDEN')
  })
})

