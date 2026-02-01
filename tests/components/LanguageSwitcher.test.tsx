import React from 'react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'

vi.mock('next/navigation', () => ({
  usePathname: vi.fn(),
  useRouter: vi.fn(),
}))

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

import LanguageSwitcher from '@/components/LanguageSwitcher'
import { usePathname, useRouter } from 'next/navigation'

describe('LanguageSwitcher', () => {
  const mockPush = vi.fn()
  const mockUseRouter = useRouter as any
  const mockUsePathname = usePathname as any

  beforeEach(() => {
    vi.clearAllMocks()
    mockUseRouter.mockReturnValue({ push: mockPush })
    ;(globalThis as any).fetch = vi.fn()
  })

  it('uses simple prefix for non-article pages', async () => {
    mockUsePathname.mockReturnValue('/about')

    render(<LanguageSwitcher locale="zh" />)

    const englishLink = screen.getByRole('link', { name: 'English' })
    expect(englishLink.getAttribute('href')).toBe('/en/about')
  })

  it('detects article page and fetches translation for /posts/slug', async () => {
    mockUsePathname.mockReturnValue('/posts/my-article')

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ translatedSlug: 'my-article-en' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )
    ;(globalThis as any).fetch = fetchMock

    render(<LanguageSwitcher locale="zh" />)

    const englishLink = screen.getByRole('link', { name: 'English' })
    fireEvent.click(englishLink)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/articles/translations?slug=my-article&currentLang=zh&targetLang=en')
      )
    })

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/en/posts/my-article-en')
    })
  })

  it('detects article page and fetches translation for /en/posts/slug', async () => {
    mockUsePathname.mockReturnValue('/en/posts/my-article-en')

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ translatedSlug: 'my-article' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )
    ;(globalThis as any).fetch = fetchMock

    render(<LanguageSwitcher locale="en" />)

    const chineseLink = screen.getByRole('link', { name: '中文' })
    fireEvent.click(chineseLink)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/articles/translations?slug=my-article-en&currentLang=en&targetLang=zh')
      )
    })

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/posts/my-article')
    })
  })

  it('falls back to simple prefix when translation not found', async () => {
    mockUsePathname.mockReturnValue('/posts/my-article')

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ translatedSlug: null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )
    ;(globalThis as any).fetch = fetchMock

    render(<LanguageSwitcher locale="zh" />)

    const englishLink = screen.getByRole('link', { name: 'English' })
    fireEvent.click(englishLink)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled()
    })

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/en/posts/my-article')
    })
  })

  it('falls back to simple prefix when API call fails', async () => {
    mockUsePathname.mockReturnValue('/posts/my-article')

    const fetchMock = vi.fn().mockRejectedValue(new Error('Network error'))
    ;(globalThis as any).fetch = fetchMock

    render(<LanguageSwitcher locale="zh" />)

    const englishLink = screen.getByRole('link', { name: 'English' })
    fireEvent.click(englishLink)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled()
    })

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/en/posts/my-article')
    })
  })
})
