import matter from 'gray-matter'
import type { SpokeFactorySummary, SpokeGeneratedDoc } from './types'

const REQUIRED_FRONTMATTER_KEYS = [
  'title',
  'seoTitle',
  'description',
  'slug',
  'animeId',
  'city',
  'language',
  'tags',
  'publishDate',
  'status',
] as const

function stripMarkdown(input: string): string {
  return input
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/[#>*_~\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export type DocValidationResult = {
  valid: boolean
  errors: string[]
  bodyLength: number
}

export function validateGeneratedMdxDoc(rawMdx: string): DocValidationResult {
  const errors: string[] = []
  const parsed = matter(rawMdx)
  const data = parsed.data as Record<string, unknown>
  const bodyText = stripMarkdown(parsed.content || '')
  const bodyLength = bodyText.length

  for (const key of REQUIRED_FRONTMATTER_KEYS) {
    const value = data[key]
    const isMissing =
      value == null || (typeof value === 'string' && !value.trim()) || (Array.isArray(value) && value.length === 0)
    if (isMissing) {
      errors.push(`Missing frontmatter: ${key}`)
    }
  }

  const tags = Array.isArray(data.tags) ? data.tags.map((x) => String(x).trim().toLowerCase()) : []
  if (!tags.includes('seo-spoke')) {
    errors.push('tags must include seo-spoke')
  }

  if (String(data.status || '') !== 'published') {
    errors.push('status must be published')
  }

  if (bodyLength < 500) {
    errors.push(`content too short: ${bodyLength} < 500`)
  }

  return {
    valid: errors.length === 0,
    errors,
    bodyLength,
  }
}

export function validateGeneratedDocs(docs: SpokeGeneratedDoc[]): string[] {
  const errors: string[] = []
  for (const doc of docs) {
    const result = validateGeneratedMdxDoc(doc.rawMdx)
    if (!result.valid) {
      for (const err of result.errors) {
        errors.push(`${doc.path}: ${err}`)
      }
    }
  }
  return errors
}

export function normalizeSummary(input: unknown): SpokeFactorySummary | null {
  if (!input || typeof input !== 'object') return null
  const data = input as Record<string, unknown>
  const mode = String(data.mode || '')
  if (mode !== 'preview' && mode !== 'generate') return null

  const toNum = (value: unknown): number => {
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string') {
      const parsed = Number.parseInt(value, 10)
      if (Number.isFinite(parsed)) return parsed
    }
    return 0
  }

  return {
    mode,
    sourcePostCount: toNum(data.sourcePostCount),
    candidateCount: toNum(data.candidateCount),
    selectedTopics: toNum(data.selectedTopics),
    generatedFiles: toNum(data.generatedFiles),
    skippedExisting: toNum(data.skippedExisting),
    skippedLowConfidence: toNum(data.skippedLowConfidence),
    skipped: Array.isArray(data.skipped)
      ? data.skipped
          .map((x) => {
            if (!x || typeof x !== 'object') return null
            return {
              reason: String((x as any).reason || ''),
              value: String((x as any).value || ''),
            }
          })
          .filter((x): x is { reason: string; value: string } => Boolean(x && x.reason))
      : [],
    errors: Array.isArray(data.errors) ? data.errors.map((x) => String(x)) : [],
    topics: Array.isArray(data.topics) ? (data.topics as any[]) : [],
    files: Array.isArray(data.files) ? (data.files as any[]) : [],
    prUrl: typeof data.prUrl === 'string' && data.prUrl.trim() ? data.prUrl : null,
  }
}
