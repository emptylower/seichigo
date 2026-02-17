import { hashText } from '@/lib/anitabi/utils'

export const MAP_TRANSLATION_TARGET_LANGUAGES = ['en', 'ja'] as const

export type MapTranslationTargetLanguage = (typeof MAP_TRANSLATION_TARGET_LANGUAGES)[number]

export type MapTranslationEntityType = 'anitabi_bangumi' | 'anitabi_point'

function normalize(value: unknown): string {
  return String(value || '').trim()
}

export function normalizeMapTargetLanguages(input: readonly string[] | null | undefined): MapTranslationTargetLanguage[] {
  if (!input || input.length === 0) return [...MAP_TRANSLATION_TARGET_LANGUAGES]

  const set = new Set<MapTranslationTargetLanguage>()
  for (const raw of input) {
    if (raw === 'en' || raw === 'ja') set.add(raw)
  }

  if (set.size === 0) return [...MAP_TRANSLATION_TARGET_LANGUAGES]
  return Array.from(set)
}

export function buildBangumiSourceContent(input: {
  titleZh: string | null | undefined
  description: string | null | undefined
  city: string | null | undefined
}): {
  title: string
  description: string | null
  city: string | null
} {
  const title = normalize(input.titleZh)
  const description = normalize(input.description)
  const city = normalize(input.city)

  return {
    title,
    description: description || null,
    city: city || null,
  }
}

export function buildBangumiSourceHash(input: {
  titleZh: string | null | undefined
  description: string | null | undefined
  city: string | null | undefined
}): string {
  const source = buildBangumiSourceContent(input)
  return hashText(`title:${source.title}\ndescription:${source.description || ''}\ncity:${source.city || ''}`)
}

export function buildPointSourceContent(input: {
  name: string | null | undefined
  nameZh: string | null | undefined
  mark: string | null | undefined
}): {
  name: string
  note: string | null
} {
  const preferredName = normalize(input.nameZh) || normalize(input.name)
  const note = normalize(input.mark)
  return {
    name: preferredName,
    note: note || null,
  }
}

export function buildPointSourceHash(input: {
  name: string | null | undefined
  nameZh: string | null | undefined
  mark: string | null | undefined
}): string {
  const source = buildPointSourceContent(input)
  return hashText(`name:${source.name}\nnote:${source.note || ''}`)
}
