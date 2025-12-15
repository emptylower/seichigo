import { describe, expect, it } from 'vitest'
import { approve, canEdit, reject, submit, unpublish, withdraw, type Actor, type ArticleState } from '@/lib/article/workflow'

const author: Actor = { userId: 'user-1', isAdmin: false }
const otherUser: Actor = { userId: 'user-2', isAdmin: false }
const admin: Actor = { userId: 'admin-1', isAdmin: true }

function article(status: ArticleState['status'], authorId: string = author.userId): ArticleState {
  return { status, authorId }
}

describe('article workflow', () => {
  it('author can edit draft/rejected; cannot edit in_review/published', () => {
    expect(canEdit(article('draft'), author)).toBe(true)
    expect(canEdit({ ...article('rejected'), rejectReason: 'needs changes' }, author)).toBe(true)

    expect(canEdit(article('in_review'), author)).toBe(false)
    expect(canEdit(article('published'), author)).toBe(false)
  })

  it('non-author cannot edit', () => {
    expect(canEdit(article('draft'), otherUser)).toBe(false)
    expect(canEdit(article('rejected'), otherUser)).toBe(false)
  })

  it('submit: draft|rejected -> in_review (author only)', () => {
    const r1 = submit(article('draft'), author)
    expect(r1.ok).toBe(true)
    if (r1.ok) expect(r1.value.status).toBe('in_review')

    const r2 = submit({ ...article('rejected'), rejectReason: 'bad' }, author)
    expect(r2.ok).toBe(true)
    if (r2.ok) {
      expect(r2.value.status).toBe('in_review')
      expect(r2.value.rejectReason ?? null).toBe(null)
    }

    const r3 = submit(article('in_review'), author)
    expect(r3.ok).toBe(false)
    if (!r3.ok) expect(r3.error.code).toBe('INVALID_STATUS')

    const r4 = submit(article('draft'), otherUser)
    expect(r4.ok).toBe(false)
    if (!r4.ok) expect(r4.error.code).toBe('FORBIDDEN')
  })

  it('withdraw: in_review -> draft (author only)', () => {
    const r1 = withdraw(article('in_review'), author)
    expect(r1.ok).toBe(true)
    if (r1.ok) expect(r1.value.status).toBe('draft')

    const r2 = withdraw(article('draft'), author)
    expect(r2.ok).toBe(false)
    if (!r2.ok) expect(r2.error.code).toBe('INVALID_STATUS')

    const r3 = withdraw(article('in_review'), otherUser)
    expect(r3.ok).toBe(false)
    if (!r3.ok) expect(r3.error.code).toBe('FORBIDDEN')
  })

  it('approve: in_review -> published (admin only)', () => {
    const r1 = approve(article('in_review'), admin)
    expect(r1.ok).toBe(true)
    if (r1.ok) expect(r1.value.status).toBe('published')

    const r2 = approve(article('draft'), admin)
    expect(r2.ok).toBe(false)
    if (!r2.ok) expect(r2.error.code).toBe('INVALID_STATUS')

    const r3 = approve(article('in_review'), author)
    expect(r3.ok).toBe(false)
    if (!r3.ok) expect(r3.error.code).toBe('FORBIDDEN')
  })

  it('reject: in_review -> rejected with reason (admin only)', () => {
    const r1 = reject(article('in_review'), admin, ' needs more detail ')
    expect(r1.ok).toBe(true)
    if (r1.ok) {
      expect(r1.value.status).toBe('rejected')
      expect(r1.value.rejectReason).toBe('needs more detail')
    }

    const r2 = reject(article('in_review'), admin, '')
    expect(r2.ok).toBe(false)
    if (!r2.ok) expect(r2.error.code).toBe('MISSING_REASON')

    const r3 = reject(article('draft'), admin, 'x')
    expect(r3.ok).toBe(false)
    if (!r3.ok) expect(r3.error.code).toBe('INVALID_STATUS')

    const r4 = reject(article('in_review'), author, 'x')
    expect(r4.ok).toBe(false)
    if (!r4.ok) expect(r4.error.code).toBe('FORBIDDEN')
  })

  it('unpublish: published -> rejected with reason (admin only)', () => {
    const r1 = unpublish(article('published'), admin, ' violation ')
    expect(r1.ok).toBe(true)
    if (r1.ok) {
      expect(r1.value.status).toBe('rejected')
      expect(r1.value.rejectReason).toBe('violation')
    }

    const r2 = unpublish(article('published'), admin, '')
    expect(r2.ok).toBe(false)
    if (!r2.ok) expect(r2.error.code).toBe('MISSING_REASON')

    const r3 = unpublish(article('in_review'), admin, 'x')
    expect(r3.ok).toBe(false)
    if (!r3.ok) expect(r3.error.code).toBe('INVALID_STATUS')

    const r4 = unpublish(article('published'), author, 'x')
    expect(r4.ok).toBe(false)
    if (!r4.ok) expect(r4.error.code).toBe('FORBIDDEN')
  })
})
