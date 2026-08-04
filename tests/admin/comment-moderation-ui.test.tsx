import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getSessionMock = vi.fn()
const toastSuccessMock = vi.fn()
const toastErrorMock = vi.fn()
const askForConfirmMock = vi.fn(async () => true)

vi.mock('@/lib/auth/session', () => ({
  getServerAuthSession: () => getSessionMock(),
}))

vi.mock('@/hooks/useAdminToast', () => ({
  useAdminToast: () => ({ success: toastSuccessMock, error: toastErrorMock }),
}))

vi.mock('@/hooks/useAdminConfirm', () => ({
  useAdminConfirm: () => askForConfirmMock,
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
}))

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('admin comment moderation UI', () => {
  beforeEach(() => {
    getSessionMock.mockReset()
    toastSuccessMock.mockReset()
    toastErrorMock.mockReset()
    askForConfirmMock.mockReset()
    askForConfirmMock.mockResolvedValue(true)
    vi.unstubAllGlobals()
  })

  it('loads reports and sends hide action', async () => {
    getSessionMock.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })
    const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
      if (input === '/api/admin/comments' && (!init?.method || init.method === 'GET')) {
        return response({
          ok: true,
          comments: [{
            id: 'comment-1',
            articleId: 'article-1',
            mdxSlug: null,
            authorId: 'author-1',
            content: 'reported content',
            status: 'visible',
            hiddenAt: null,
            hiddenBy: null,
            createdAt: '2025-01-01T00:00:00.000Z',
            reports: [{ id: 'report-1', reporterId: 'reporter-1', reason: 'spam', createdAt: '2025-01-01T01:00:00.000Z' }],
          }],
        })
      }
      return response({ ok: true, comment: { id: 'comment-1', status: 'hidden' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const AdminCommentsPage = (await import('@/app/(authed)/admin/comments/page')).default
    render(await AdminCommentsPage())

    expect(await screen.findByText('reported content')).toBeInTheDocument()
    expect(screen.getByText(/垃圾广告或灌水/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '隐藏' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/admin/comments/comment-1', expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ action: 'hide' }),
      }))
    })
    expect(toastSuccessMock).toHaveBeenCalledWith('评论已隐藏')
  })
})
