import React from 'react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import SubmitCenterClient from '@/app/(site)/submit/ui'

const fetchMock = vi.fn()
const pushMock = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: pushMock, refresh: vi.fn() }),
}))

beforeEach(() => {
  fetchMock.mockReset()
  pushMock.mockReset()
  ;(globalThis as any).fetch = fetchMock
})

function jsonResponse(body: any, status: number = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('submit center ui', () => {
  it('shows login prompt when not signed in', () => {
    render(<SubmitCenterClient user={null} />)
    expect(screen.getByRole('heading', { name: '创作中心' })).toBeInTheDocument()
    expect(screen.getByText('请先登录后再进行创作与投稿。')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '去登录' })).toHaveAttribute('href', '/auth/signin?callbackUrl=%2Fsubmit')
  })

  it('shows “新建文章” entry when signed in', () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ items: [] }))
    render(<SubmitCenterClient user={{ id: 'user-1' }} />)
    expect(screen.getByRole('link', { name: '新建文章' })).toHaveAttribute('href', '/submit/new')
  })

  it('calls submit API when clicking “提交审核”', async () => {
    const now = new Date().toISOString()
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          items: [{ id: 'a1', slug: 'my-slug', title: 'My Title', status: 'draft', rejectReason: null, updatedAt: now }],
        })
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
      .mockResolvedValueOnce(
        jsonResponse({
          items: [{ id: 'a1', slug: 'my-slug', title: 'My Title', status: 'in_review', rejectReason: null, updatedAt: now }],
        })
      )

    render(<SubmitCenterClient user={{ id: 'user-1' }} />)

    const button = await screen.findByRole('button', { name: '提交审核' })
    fireEvent.click(button)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/articles/a1/submit', { method: 'POST' })
    })

    expect(await screen.findByText('已提交审核')).toBeInTheDocument()
  })

  it('calls delete API when clicking “删除”', async () => {
    ;(window as any).confirm = vi.fn(() => true)

    const now = new Date().toISOString()
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          items: [{ id: 'a1', slug: 'my-slug', title: 'My Title', status: 'draft', rejectReason: null, updatedAt: now }],
        })
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
      .mockResolvedValueOnce(jsonResponse({ items: [] }))

    render(<SubmitCenterClient user={{ id: 'user-1' }} />)

    const button = await screen.findByRole('button', { name: '删除' })
    fireEvent.click(button)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/articles/a1', { method: 'DELETE' })
    })

    expect(await screen.findByText('已删除')).toBeInTheDocument()
  })

  it('starts revision when clicking “发起更新” for published item', async () => {
    const now = new Date().toISOString()
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          items: [{ id: 'a1', slug: 'my-slug', title: 'My Title', status: 'published', rejectReason: null, updatedAt: now }],
        })
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true, revision: { id: 'r1' } }))

    render(<SubmitCenterClient user={{ id: 'user-1' }} />)

    fireEvent.click(await screen.findByRole('button', { name: '已发布' }))

    const button = await screen.findByRole('button', { name: '发起更新' })
    fireEvent.click(button)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/articles/a1/revision', { method: 'POST' })
    })

    expect(pushMock).toHaveBeenCalledWith('/submit/revisions/r1')
  })
})
