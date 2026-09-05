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
    allowedTags: [
      'b', 'i', 'em', 'strong', 'code', 'a', 'pre', 'blockquote', 'ul', 'ol', 'li', 'p', 'br',
      // 聊天/评论常见 markdown 元素：标题、分割线、删除线、表格
      'h1', 'h2', 'h3', 'h4', 'hr', 'del',
      'table', 'thead', 'tbody', 'tr', 'th', 'td',
    ],
    allowedAttributes: {
      'a': ['href', 'target', 'rel'],
      'th': ['align'],
      'td': ['align'],
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
