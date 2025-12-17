import { describe, expect, it } from 'vitest'
import { sanitizeRichTextHtml } from '@/lib/richtext/sanitize'

describe('richtext sanitize', () => {
  it('removes event handler attributes (on*)', () => {
    const out = sanitizeRichTextHtml('<p>hi</p><img src="https://example.com/a.jpg" onerror="alert(1)" />')
    expect(out).toContain('<img')
    expect(out).toContain('src="https://example.com/a.jpg"')
    expect(out).not.toContain('onerror')
    expect(out).not.toContain('alert(1)')
  })

  it('removes script tags and their content', () => {
    const out = sanitizeRichTextHtml('<p>safe</p><script>alert(1)</script>')
    expect(out).toContain('<p>safe</p>')
    expect(out).not.toContain('<script')
    expect(out).not.toContain('alert(1)')
  })

  it('removes disallowed tags like hr and video', () => {
    const out = sanitizeRichTextHtml('<hr><video src="https://example.com/v.mp4"></video><p>ok</p>')
    expect(out).toContain('<p>ok</p>')
    expect(out).not.toContain('<hr')
    expect(out).not.toContain('<video')
  })

  it('strips javascript: href from links', () => {
    const out = sanitizeRichTextHtml('<a href="javascript:alert(1)">x</a>')
    expect(out).toContain('<a>x</a>')
    expect(out).not.toContain('href=')
    expect(out).not.toContain('javascript:')
  })

  it('enforces color palette whitelist', () => {
    const allowed = sanitizeRichTextHtml('<span style="color:#3b82f6">x</span>')
    expect(allowed).toContain('style="color:#3b82f6"')

    const allowedBg = sanitizeRichTextHtml('<span style="background-color:#fecaca">x</span>')
    expect(allowedBg).toContain('style="background-color:#fecaca"')

    const allowedBoth = sanitizeRichTextHtml('<span style="color:#3b82f6; background-color:#fecaca">x</span>')
    expect(allowedBoth).toContain('color:#3b82f6')
    expect(allowedBoth).toContain('background-color:#fecaca')

    const badExpr = sanitizeRichTextHtml('<span style="color:expression(alert(1))">x</span>')
    expect(badExpr).toContain('<span>x</span>')
    expect(badExpr).not.toContain('expression')
    expect(badExpr).not.toContain('style=')

    const badHex = sanitizeRichTextHtml('<span style="color:#ff0000">x</span>')
    expect(badHex).toContain('<span>x</span>')
    expect(badHex).not.toContain('#ff0000')
    expect(badHex).not.toContain('style=')
  })

  it('preserves align/indent data attributes (whitelist + clamp)', () => {
    const ok = sanitizeRichTextHtml('<p data-align="center" data-indent="2">x</p>')
    expect(ok).toContain('<p data-align="center" data-indent="2">x</p>')

    const clamp = sanitizeRichTextHtml('<p data-indent="99">x</p>')
    expect(clamp).toContain('data-indent="6"')

    const bad = sanitizeRichTextHtml('<p data-align="evil" data-indent="-1">x</p>')
    expect(bad).toContain('<p>x</p>')
    expect(bad).not.toContain('data-align')
    expect(bad).not.toContain('data-indent')

    const img = sanitizeRichTextHtml('<img src="https://example.com/a.jpg" data-align="right" data-indent="3" />')
    expect(img).toContain('data-align="right"')
    expect(img).toContain('data-indent="3"')
  })

  it('preserves strikethrough tags', () => {
    const out = sanitizeRichTextHtml('<p><s>gone</s> <del>gone2</del></p>')
    expect(out).toContain('<s>gone</s>')
    expect(out).toContain('<del>gone2</del>')
  })

  it('enforces font-family whitelist', () => {
    const allowed = sanitizeRichTextHtml('<span style="font-family: system-ui">x</span>')
    expect(allowed).toMatch(/font-family:system-ui/)

    const disallowed = sanitizeRichTextHtml('<span style="font-family: Comic Sans MS">x</span>')
    expect(disallowed).toContain('<span>x</span>')
    expect(disallowed).not.toContain('font-family')
    expect(disallowed).not.toContain('style=')
  })

  it('preserves table and code block structure', () => {
    const html =
      '<table><thead><tr><th>H</th></tr></thead><tbody><tr><td>Cell</td></tr></tbody></table>' +
      '<pre><code>const x = 1;</code></pre>'
    const out = sanitizeRichTextHtml(html)
    expect(out).toContain('<table>')
    expect(out).toContain('<thead>')
    expect(out).toContain('<tbody>')
    expect(out).toContain('<pre><code>const x = 1;</code></pre>')
  })

  it('allows external images via http(s)', () => {
    const httpsOut = sanitizeRichTextHtml('<img src="https://example.com/a.jpg" alt="a" />')
    expect(httpsOut).toContain('src="https://example.com/a.jpg"')

    const httpOut = sanitizeRichTextHtml('<img src="http://example.com/a.jpg" alt="a" />')
    expect(httpOut).toContain('src="http://example.com/a.jpg"')
  })

  it('blocks dangerous image src protocols', () => {
    const jsOut = sanitizeRichTextHtml('<img src="javascript:alert(1)" />')
    expect(jsOut).not.toContain('<img')
    expect(jsOut).not.toContain('javascript:')

    const dataOut = sanitizeRichTextHtml('<img src="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==" />')
    expect(dataOut).not.toContain('<img')
    expect(dataOut).not.toContain('data:')
  })

  it('preserves figure/figcaption structure for image captions', () => {
    const html =
      '<figure data-align="center" data-indent="2">' +
      '<img src="/assets/abc123" alt="x" />' +
      '<figcaption><strong>图 1</strong> 说明 <a href="https://example.com">link</a></figcaption>' +
      '</figure>'
    const out = sanitizeRichTextHtml(html)
    expect(out).toContain('<figure data-align="center" data-indent="2">')
    expect(out).toContain('<img src="/assets/abc123" alt="x"')
    expect(out).toContain('<figcaption>')
    expect(out).toContain('<strong>图 1</strong>')
    expect(out).toContain('<a href="https://example.com">link</a>')
  })

  it('preserves figure image transform wrapper with safe styles', () => {
    const html =
      '<figure data-align="center">' +
      '<div data-figure-image-frame="true" data-width-pct="80" data-crop-h="240" style="width:80%; height:240px; aspect-ratio: 16 / 9; position:fixed">' +
      '<img src="/assets/abc123" alt="x" style="--seichi-rot:90deg; --seichi-flip-x:-1; --seichi-w:200%; --seichi-h:50%; --seichi-pos:40% 60%; color:red" />' +
      '</div>' +
      '<figcaption>cap</figcaption>' +
      '</figure>'
    const out = sanitizeRichTextHtml(html)
    expect(out).toContain('data-figure-image-frame="true"')
    expect(out).toContain('data-width-pct="80"')
    expect(out).toContain('data-crop-h="240"')
    expect(out).toContain('width:80%')
    expect(out).toContain('height:240px')
    expect(out).toContain('aspect-ratio')
    expect(out).not.toContain('position:fixed')
    expect(out).toContain('--seichi-rot:90deg')
    expect(out).toContain('--seichi-flip-x:-1')
    expect(out).toContain('--seichi-w:200%')
    expect(out).toContain('--seichi-h:50%')
    expect(out).toContain('--seichi-pos:40% 60%')
    expect(out).not.toContain('color:red')
  })
})
