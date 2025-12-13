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
    const allowed = sanitizeRichTextHtml('<span style="color:#db2777">x</span>')
    expect(allowed).toContain('style="color:#db2777"')

    const badExpr = sanitizeRichTextHtml('<span style="color:expression(alert(1))">x</span>')
    expect(badExpr).toContain('<span>x</span>')
    expect(badExpr).not.toContain('expression')
    expect(badExpr).not.toContain('style=')

    const badHex = sanitizeRichTextHtml('<span style="color:#ff0000">x</span>')
    expect(badHex).toContain('<span>x</span>')
    expect(badHex).not.toContain('#ff0000')
    expect(badHex).not.toContain('style=')
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
})

