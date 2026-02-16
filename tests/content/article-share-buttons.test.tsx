import React from 'react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import ArticleShareButtons from '@/components/content/ArticleShareButtons'

describe('ArticleShareButtons', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('builds Twitter and Reddit links with Seichigo tag', () => {
    render(
      <ArticleShareButtons
        url="https://seichigo.com/posts/btr-uji-day1"
        title="BTR Uji Day 1"
        locale="en"
      />
    )

    const twitter = screen.getByRole('link', { name: /share to twitter/i }) as HTMLAnchorElement
    const reddit = screen.getByRole('link', { name: /share to reddit/i }) as HTMLAnchorElement

    const twitterUrl = new URL(twitter.href)
    expect(twitterUrl.origin).toBe('https://twitter.com')
    expect(twitterUrl.pathname).toBe('/intent/tweet')
    expect(twitterUrl.searchParams.get('url')).toBe('https://seichigo.com/posts/btr-uji-day1')
    expect(twitterUrl.searchParams.get('hashtags')).toBe('Seichigo')

    const redditUrl = new URL(reddit.href)
    expect(redditUrl.origin).toBe('https://www.reddit.com')
    expect(redditUrl.pathname).toBe('/submit')
    expect(redditUrl.searchParams.get('url')).toBe('https://seichigo.com/posts/btr-uji-day1')
    expect(redditUrl.searchParams.get('title')).toBe('[Seichigo] BTR Uji Day 1')
  })

  it('copies fallback text and opens Instagram when Web Share API is unavailable', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true })
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)

    render(
      <ArticleShareButtons
        url="https://seichigo.com/posts/btr-uji-day1"
        title="BTR Uji Day 1"
        locale="zh"
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /share to instagram/i }))

    await waitFor(() => {
      expect(writeText).toHaveBeenCalled()
    })
    expect(writeText.mock.calls[0]?.[0]).toContain('#Seichigo')
    expect(writeText.mock.calls[0]?.[0]).toContain('https://seichigo.com/posts/btr-uji-day1')
    expect(openSpy).toHaveBeenCalledWith('https://www.instagram.com/', '_blank', 'noopener,noreferrer')
  })
})
