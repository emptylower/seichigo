import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { PublicPostListItem } from '@/lib/posts/types'
import BookShelf from '@/components/bookstore/BookShelf'

vi.mock('@/components/bookstore/BookCover', () => ({
  default: function MockBookCover({ title }: { title: string }) {
    return <div>{title}</div>
  },
}))

function makeItems(count: number): PublicPostListItem[] {
  return Array.from({ length: count }, (_, idx) => ({
    source: 'db',
    path: `/posts/${idx + 1}`,
    title: `Post ${idx + 1}`,
    animeIds: ['your-name'],
    city: 'tokyo',
    tags: [],
  }))
}

function setupScrollableMetrics(el: HTMLDivElement, opts: { clientWidth: number; scrollWidth: number; scrollLeft?: number }) {
  let left = opts.scrollLeft ?? 0
  Object.defineProperty(el, 'clientWidth', { configurable: true, get: () => opts.clientWidth })
  Object.defineProperty(el, 'scrollWidth', { configurable: true, get: () => opts.scrollWidth })
  Object.defineProperty(el, 'scrollLeft', {
    configurable: true,
    get: () => left,
    set: (value: number) => {
      left = value
    },
  })

  const scrollByMock = vi.fn((input: { left?: number }) => {
    left += Number(input.left || 0)
  })
  Object.defineProperty(el, 'scrollBy', { configurable: true, value: scrollByMock })
  return { getScrollLeft: () => left, scrollByMock }
}

describe('BookShelf', () => {
  it('shows arrow controls when content overflows and scrolls on next click', async () => {
    const { container } = render(<BookShelf items={makeItems(5)} locale="en" />)
    const shelf = container.querySelector('div.overflow-x-auto') as HTMLDivElement
    const { scrollByMock } = setupScrollableMetrics(shelf, { clientWidth: 480, scrollWidth: 1200, scrollLeft: 0 })

    fireEvent(window, new Event('resize'))

    const nextButton = await screen.findByRole('button', { name: 'Scroll right' })
    fireEvent.click(nextButton)

    expect(scrollByMock).toHaveBeenCalledTimes(1)
    expect(scrollByMock).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'smooth' }))
    expect(scrollByMock.mock.calls[0]?.[0]?.left).toBeGreaterThan(0)
  })

  it('does not show arrow controls when content does not overflow', async () => {
    const { container } = render(<BookShelf items={makeItems(2)} locale="en" />)
    const shelf = container.querySelector('div.overflow-x-auto') as HTMLDivElement
    setupScrollableMetrics(shelf, { clientWidth: 900, scrollWidth: 900, scrollLeft: 0 })

    fireEvent(window, new Event('resize'))

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Scroll left' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Scroll right' })).not.toBeInTheDocument()
    })
  })

  it('supports mouse drag scrolling and suppresses click after drag', async () => {
    const { container } = render(<BookShelf items={makeItems(5)} locale="en" />)
    const shelf = container.querySelector('div.overflow-x-auto') as HTMLDivElement
    const { getScrollLeft } = setupScrollableMetrics(shelf, { clientWidth: 480, scrollWidth: 1200, scrollLeft: 80 })

    fireEvent(window, new Event('resize'))
    await screen.findByRole('button', { name: 'Scroll right' })

    fireEvent.mouseDown(shelf, { button: 0, clientX: 300 })
    fireEvent.mouseMove(shelf, { clientX: 200 })
    fireEvent.mouseUp(shelf, { clientX: 200 })

    expect(getScrollLeft()).toBe(180)

    const firstLink = container.querySelector('a[href="/posts/1"]') as HTMLAnchorElement
    const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true })
    firstLink.dispatchEvent(clickEvent)
    expect(clickEvent.defaultPrevented).toBe(true)
  })
})
