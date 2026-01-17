import { describe, expect, it } from 'vitest'
import { sanitizeRichTextHtml } from '@/lib/richtext/sanitize'

describe('repro image drop', () => {
  it('keeps frame wrapper if attribute value is empty string', () => {
    const html = '<div data-figure-image-frame="" data-mode="transform"><img src="/assets/abc"></div>'
    const out = sanitizeRichTextHtml(html)
    expect(out).toContain('data-figure-image-frame="true"')
    expect(out).toContain('<img')
    expect(out).toContain('src="/assets/abc')
  })

  it('keeps frame wrapper if attribute value is missing', () => {
    const html = '<div data-figure-image-frame data-mode="transform"><img src="/assets/abc"></div>'
    const out = sanitizeRichTextHtml(html)
    expect(out).toContain('data-figure-image-frame="true"')
    expect(out).toContain('<img')
    expect(out).toContain('src="/assets/abc')
  })
})
