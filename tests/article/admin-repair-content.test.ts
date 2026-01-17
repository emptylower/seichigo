import { describe, expect, it } from 'vitest'
import { sanitizeRichTextHtml } from '@/lib/richtext/sanitize'
import { renderArticleContentHtmlFromJson } from '@/lib/article/repair'

describe('admin repair: render contentHtml from contentJson', () => {
  it('renders figureImage wrapper with explicit marker attributes', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'figureImage',
          attrs: {
            src: '/assets/abc',
            alt: '',
            widthPct: 100,
            mode: 'transform',
            rotate: 0,
            flipX: false,
            flipY: false,
            cropL: 0,
            cropT: 0,
            cropR: 0,
            cropB: 0,
            naturalWidth: 100,
            naturalHeight: 100,
            caption: false,
            cropEditing: false,
          },
          content: [],
        },
      ],
    }

    const html = renderArticleContentHtmlFromJson(doc)
    const sanitized = sanitizeRichTextHtml(html)

    expect(sanitized).toContain('data-figure-image-frame="true"')
    expect(sanitized).toContain('data-figure-image-container="true"')
    expect(sanitized).toContain('src="/assets/abc')
  })
})
