import StarterKit from '@tiptap/starter-kit'
import { generateHTML } from '@tiptap/html'

import { InlineCode } from '@/components/editor/extensions/InlineCode'
import { TextColor } from '@/components/editor/extensions/TextColor'
import { TextBackground } from '@/components/editor/extensions/TextBackground'
import { FigureImage } from '@/components/editor/extensions/FigureImage'
import { SeichiRoute } from '@/components/editor/extensions/SeichiRoute'
import { SeichiCallout } from '@/components/editor/extensions/SeichiCallout'
import { BlockLayout } from '@/components/editor/extensions/BlockLayout'
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
    InlineCode,
    TextColor,
    TextBackground,
    FigureImage,
    SeichiRoute,
    SeichiCallout,
    BlockLayout,
  ])

  return sanitizeRichTextHtml(html)
}
