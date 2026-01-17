import StarterKit from '@tiptap/starter-kit'
import { generateHTML } from '@tiptap/html'

import { TextColor } from '@/components/editor/extensions/TextColor'
import { TextBackground } from '@/components/editor/extensions/TextBackground'
import { BlockLayout } from '@/components/editor/extensions/BlockLayout'

import { FigureImageServer, InlineCodeServer, SeichiCalloutServer, SeichiRouteServer } from '@/lib/article/repairExtensions'
import { sanitizeRichTextHtml } from '@/lib/richtext/sanitize'

export function renderArticleContentHtmlFromJson(contentJson: unknown): string {
  const doc = contentJson && typeof contentJson === 'object' ? (contentJson as any) : null
  if (!doc) return ''

  const html = generateHTML(doc, [
    StarterKit.configure({
      horizontalRule: false,
      heading: { levels: [1, 2, 3] },
      code: false,
      link: {
        openOnClick: false,
        autolink: false,
        linkOnPaste: true,
      },
    }),
    InlineCodeServer,
    TextColor,
    TextBackground,
    FigureImageServer,
    SeichiRouteServer,
    SeichiCalloutServer,
    BlockLayout,
  ])

  return sanitizeRichTextHtml(html)
}
