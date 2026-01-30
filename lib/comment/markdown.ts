import { marked } from 'marked'
import sanitizeHtml from 'sanitize-html'

export function renderCommentMarkdown(content: string): string {
  if (!content || typeof content !== 'string') {
    return ''
  }

  const rawHtml = marked(content, {
    breaks: true,
    gfm: true,
  }) as string

  const cleanHtml = sanitizeHtml(rawHtml, {
    allowedTags: ['b', 'i', 'em', 'strong', 'code', 'a', 'pre', 'blockquote', 'ul', 'ol', 'li', 'p', 'br'],
    allowedAttributes: {
      'a': ['href'],
    },
    allowedSchemes: ['http', 'https'],
    allowedSchemesByTag: {},
    transformTags: {
      'a': (tagName, attribs) => {
        return {
          tagName: 'a',
          attribs: {
            href: attribs.href || '',
            target: '_blank',
            rel: 'noopener noreferrer',
          },
        }
      },
    },
  })

  return cleanHtml.trim()
}
