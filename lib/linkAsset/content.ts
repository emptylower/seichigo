import { sanitizeRichTextHtml } from '@/lib/richtext/sanitize'
import { getBundledLinkAssetContentHtml } from './static'

function normalizeContentPath(input: string): string | null {
  const raw = String(input || '').trim()
  if (!raw) return null
  if (!raw.startsWith('/content/')) return null
  if (raw.includes('..')) return null
  return raw
}

export async function readLinkAssetContentHtml(contentFile: string | undefined): Promise<string | null> {
  const normalized = typeof contentFile === 'string' ? normalizeContentPath(contentFile) : null
  if (!normalized) return null
  const contentHtml = getBundledLinkAssetContentHtml(normalized)
  if (!contentHtml) return null
  return sanitizeRichTextHtml(contentHtml, {
    contentMode: 'mdx-components',
    imageMode: 'progressive',
  })
}
