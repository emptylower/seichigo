import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import CommentItem from '@/components/comments/CommentItem'

const comment = {
  id: 'comment-1',
  authorId: 'author-1',
  content: 'hello',
  contentHtml: '<p>hello</p>',
  createdAt: '2025-01-01T00:00:00.000Z',
  likeCount: 0,
  author: { id: 'author-1' },
  replies: [],
}

describe('CommentItem report control', () => {
  it('shows the report control only to logged-in users and submits the selected reason', async () => {
    const onReport = vi.fn(async () => ({ ok: true as const }))
    const onReply = vi.fn(async () => true)
    const onDelete = vi.fn()

    const { unmount } = render(
      <CommentItem
        comment={comment}
        onReply={onReply}
        onDelete={onDelete}
        onReport={onReport}
      />
    )
    expect(screen.queryByRole('button', { name: /举报/ })).not.toBeInTheDocument()
    unmount()

    render(
      <CommentItem
        comment={comment}
        onReply={onReply}
        onDelete={onDelete}
        currentUserId="user-1"
        onReport={onReport}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /举报/ }))
    fireEvent.change(screen.getByLabelText('举报原因'), { target: { value: 'harassment' } })
    fireEvent.click(screen.getByRole('button', { name: '提交举报' }))

    await waitFor(() => {
      expect(onReport).toHaveBeenCalledWith('comment-1', 'harassment')
    })
  })
})
