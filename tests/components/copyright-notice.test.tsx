import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import CopyrightNotice from '@/components/legal/CopyrightNotice'

describe('CopyrightNotice', () => {
  it('renders attribution text and contact link for zh', () => {
    render(<CopyrightNotice locale="zh" />)
    expect(screen.getByText(/著作权人/)).toBeTruthy()
    expect(screen.getByRole('link', { name: /版权|联系/ }).getAttribute('href')).toBe('/help')
  })

  it('renders English attribution for en', () => {
    render(<CopyrightNotice locale="en" />)
    expect(screen.getByText(/copyright holders/i)).toBeTruthy()
    expect(screen.getByRole('link', { name: /copyright/i }).getAttribute('href')).toBe('/en/help')
  })

  it('renders Japanese attribution for ja', () => {
    render(<CopyrightNotice locale="ja" />)
    expect(screen.getByText(/本記事中のアニメ画面/)).toBeTruthy()
    expect(screen.getByRole('link', { name: /著作権/ }).getAttribute('href')).toBe('/ja/help')
  })

  it.each([
    ['app/(site)/posts/[slug]/page.tsx', 'zh'],
    ['app/en/posts/[slug]/page.tsx', 'en'],
    ['app/ja/posts/[slug]/page.tsx', 'ja'],
  ] as const)('is mounted after article content and before comments in %s', (path, locale) => {
    const source = readFileSync(path, 'utf8')
    const noticeIndex = source.indexOf(`<CopyrightNotice locale="${locale}" />`)
    expect(source).toContain("import CopyrightNotice from '@/components/legal/CopyrightNotice'")
    expect(noticeIndex).toBeGreaterThan(source.indexOf('<ProgressiveImagesRuntime'))
    expect(noticeIndex).toBeLessThan(source.indexOf('<CommentSection'))
  })
})
