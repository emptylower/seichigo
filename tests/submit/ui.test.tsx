import React from 'react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import SubmitCenterClient from '@/app/(site)/submit/ui'

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
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
})

