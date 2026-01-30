import { describe, it, expect } from 'vitest'
import { renderCommentMarkdown } from '@/lib/comment/markdown'

describe('renderCommentMarkdown', () => {
  it('renders bold text', () => {
    const result = renderCommentMarkdown('**bold**')
    expect(result).toContain('<strong>bold</strong>')
  })

  it('renders italic text', () => {
    const result = renderCommentMarkdown('*italic*')
    expect(result).toContain('<em>italic</em>')
  })

  it('renders inline code', () => {
    const result = renderCommentMarkdown('`code`')
    expect(result).toContain('<code>code</code>')
  })

  it('renders links with https', () => {
    const result = renderCommentMarkdown('[link](https://example.com)')
    expect(result).toContain('href="https://example.com"')
  })

  it('renders links with http', () => {
    const result = renderCommentMarkdown('[link](http://example.com)')
    expect(result).toContain('href="http://example.com"')
  })

  it('renders code blocks', () => {
    const result = renderCommentMarkdown('```\ncode block\n```')
    expect(result).toContain('<pre>')
    expect(result).toContain('<code>')
  })

  it('renders blockquotes', () => {
    const result = renderCommentMarkdown('> quote')
    expect(result).toContain('<blockquote>')
  })

  it('renders unordered lists', () => {
    const result = renderCommentMarkdown('- item 1\n- item 2')
    expect(result).toContain('<ul>')
    expect(result).toContain('<li>')
  })

  it('renders ordered lists', () => {
    const result = renderCommentMarkdown('1. item 1\n2. item 2')
    expect(result).toContain('<ol>')
    expect(result).toContain('<li>')
  })

  it('filters javascript: links', () => {
    const result = renderCommentMarkdown('[xss](javascript:alert(1))')
    expect(result).not.toContain('javascript:')
  })

  it('filters data: links', () => {
    const result = renderCommentMarkdown('[xss](data:text/html,<script>alert(1)</script>)')
    expect(result).not.toContain('data:')
  })

  it('removes script tags', () => {
    const result = renderCommentMarkdown('<script>alert(1)</script>')
    expect(result).not.toContain('<script>')
    expect(result).not.toContain('alert')
  })

  it('removes img tags', () => {
    const result = renderCommentMarkdown('<img src="x" onerror="alert(1)">')
    expect(result).not.toContain('<img>')
    expect(result).not.toContain('onerror')
  })

  it('removes iframe tags', () => {
    const result = renderCommentMarkdown('<iframe src="evil.com"></iframe>')
    expect(result).not.toContain('<iframe>')
  })

  it('removes onclick attributes', () => {
    const result = renderCommentMarkdown('<a href="#" onclick="alert(1)">click</a>')
    expect(result).not.toContain('onclick')
  })

  it('handles empty content', () => {
    const result = renderCommentMarkdown('')
    expect(result).toBe('')
  })

  it('handles null content', () => {
    const result = renderCommentMarkdown(null as any)
    expect(result).toBe('')
  })

  it('handles undefined content', () => {
    const result = renderCommentMarkdown(undefined as any)
    expect(result).toBe('')
  })

  it('preserves line breaks', () => {
    const result = renderCommentMarkdown('line 1\nline 2')
    expect(result).toContain('<br />')
  })

  it('renders complex markdown', () => {
    const markdown = `
# Heading
**Bold** and *italic* text
[Link](https://example.com)
\`inline code\`
> Quote
- List item
    `
    const result = renderCommentMarkdown(markdown)
    expect(result).toContain('<strong>Bold</strong>')
    expect(result).toContain('<em>italic</em>')
    expect(result).toContain('href="https://example.com"')
    expect(result).toContain('<code>inline code</code>')
    expect(result).toContain('<blockquote>')
    expect(result).toContain('<li>')
  })
})
