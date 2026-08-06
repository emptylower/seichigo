import { sanitizeRichTextHtml } from '@/lib/richtext/sanitize'
import { getBundledLinkAssetContentHtml } from './static'
import { normalizeContentPath } from './contentPath.mjs'

export { normalizeContentPath } from './contentPath.mjs'

export async function readLinkAssetContentHtml(contentFile: string | undefined): Promise<string | null> {
  const declaredContentFile = typeof contentFile === 'string' ? contentFile.trim() : ''
  const normalized = typeof contentFile === 'string' ? normalizeContentPath(contentFile) : null
  const contentHtml = normalized ? getBundledLinkAssetContentHtml(normalized) : null
  const sanitized = contentHtml
    ? sanitizeRichTextHtml(contentHtml, {
        contentMode: 'mdx-components',
        imageMode: 'progressive',
      })
    : ''

  if (!sanitized) {
    if (declaredContentFile) {
      console.error('[degraded:resources.asset-content] declared asset content is unavailable', {
        contentFile: declaredContentFile,
      })
    }
    return null
  }

  return sanitized
}
