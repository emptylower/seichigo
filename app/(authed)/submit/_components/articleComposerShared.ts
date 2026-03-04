import type { CityOption } from '@/components/city/CityMultiSelect'

export type ArticleStatus = 'draft' | 'in_review' | 'rejected' | 'published'
export type ComposerMode = 'article' | 'revision'

export type ArticleComposerInitial = {
  id: string
  title: string
  seoTitle: string | null
  description: string | null
  animeIds: string[]
  city: string | null
  cityIds?: string[]
  cities?: CityOption[]
  routeLength: string | null
  tags: string[]
  cover: string | null
  contentJson: any | null
  contentHtml: string
  status: ArticleStatus | 'approved'
  rejectReason: string | null
  updatedAt: string
}

export type AnimeOption = { id: string; name?: string | null }

export type SaveState = 'idle' | 'creating' | 'saving' | 'saved' | 'error'
export type FlushReason = 'debounced' | 'retry' | 'postflight'

export function parseTags(input: string): string[] {
  return input
    .split(/[,，]/)
    .map((x) => x.trim())
    .filter(Boolean)
}

export function countPlainText(html: string): number {
  if (!html) return 0
  const withoutTags = html.replace(/<[^>]*>/g, ' ')
  const collapsed = withoutTags.replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim()
  return collapsed.length
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export function estimateEditorShellMinHeight(html: string): number {
  const source = String(html || '')
  const textChars = countPlainText(source)
  const imageCount = (source.match(/<img\b/gi) || []).length
  const blockCount = (source.match(/<(p|h[1-6]|li|blockquote|pre|figure)\b/gi) || []).length

  // Keep placeholder height closer to the eventual editor size to reduce CLS on heavy drafts.
  const textHeight = Math.ceil(textChars / 34) * 20
  const blockSpacing = blockCount * 6
  const imageHeight = imageCount * 320
  const estimated = 620 + textHeight + blockSpacing + imageHeight
  return clampNumber(estimated, 560, 2200)
}

export function formatStatus(status: ArticleStatus | 'approved') {
  if (status === 'draft') return '草稿'
  if (status === 'rejected') return '被拒'
  if (status === 'in_review') return '审核中'
  if (status === 'approved') return '已通过'
  return '已发布'
}

export function normalizeAnimeOption(anime: any): AnimeOption {
  return { id: String(anime?.id || '').trim(), name: anime?.name ?? null }
}
