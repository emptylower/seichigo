import { describe, expect, it } from 'vitest'
import { sanitizeRichTextHtml } from '@/lib/richtext/sanitize'

describe('sanitizeRichTextHtml crop vars', () => {
  it('drops crop attrs when crop vars are missing (avoid invisible images)', () => {
    const html =
      '<figure data-figure-image="true" data-width-pct="50" style="width:50%">' +
      '<div data-figure-image-container data-width-pct="50">' +
      '<div data-figure-image-frame data-mode="transform" style="aspect-ratio: 16 / 9;">' +
      '<img src="/assets/abc123" data-crop-l="2" style="--seichi-rot:0deg;--seichi-flip-x:1;--seichi-flip-y:1;--seichi-w:100%;--seichi-h:100%;--seichi-crop-left:-2.04%;--seichi-crop-top:0%;--seichi-crop-width --seichi-crop-height:100%;" />' +
      '</div>' +
      '</div>' +
      '</figure>'

    const out = sanitizeRichTextHtml(html, { imageMode: 'progressive' })

    expect(out).toContain('data-seichi-full="/assets/abc123"')
    expect(out).not.toContain('data-crop-l=')
    expect(out).not.toContain('data-crop-t=')
    expect(out).not.toContain('data-crop-r=')
    expect(out).not.toContain('data-crop-b=')
  })
})
