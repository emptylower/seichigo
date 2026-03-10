import {
  MAP_TRANSLATION_TARGET_LANGUAGES,
  buildBangumiSourceHashFromContent,
  buildPointSourceHashFromContent,
  type MapTranslationTargetLanguage,
} from '@/lib/translation/mapSourceHash'

const ENGLISH_RE = /[A-Za-z]/
const JAPANESE_RE = /[ぁ-んァ-ヶー々〆〤]/

type BangumiI18nRow = {
  language: string
  sourceHash?: string | null
  title?: string | null
  description?: string | null
  city?: string | null
}

type PointI18nRow = {
  language: string
  sourceHash?: string | null
  name?: string | null
  note?: string | null
}

export type BangumiLocalizedContent = {
  title: string
  description: string | null
  city: string | null
}

export type PointLocalizedContent = {
  name: string
  note: string | null
}

export type BangumiTranslationSourceRow = {
  id: number | string
  titleZh?: string | null
  titleJaRaw?: string | null
  titleOriginal?: string | null
  titleEnglish?: string | null
  description?: string | null
  city?: string | null
  i18n?: BangumiI18nRow[]
}

export type PointTranslationSourceRow = {
  id: string
  name?: string | null
  nameZh?: string | null
  mark?: string | null
  i18n?: PointI18nRow[]
}

type LocalizedSourceResult<TContent> = {
  sourceLanguage: MapTranslationTargetLanguage | 'und'
  sourceContent: TContent
  sourceHash: string
}

function normalize(value: unknown): string {
  return String(value || '').trim()
}

function hasEnglishScript(value: unknown): boolean {
  return ENGLISH_RE.test(normalize(value))
}

function hasJapaneseScript(value: unknown): boolean {
  return JAPANESE_RE.test(normalize(value))
}

function isBangumiTitlePlaceholder(value: string, id: number | string): boolean {
  return value === `#${String(id)}`
}

function findBangumiI18n(
  row: BangumiTranslationSourceRow,
  language: MapTranslationTargetLanguage
): BangumiI18nRow | null {
  return row.i18n?.find((item) => item.language === language) || null
}

function findPointI18n(
  row: PointTranslationSourceRow,
  language: MapTranslationTargetLanguage
): PointI18nRow | null {
  return row.i18n?.find((item) => item.language === language) || null
}

export function hasBangumiBaseZhContent(row: BangumiTranslationSourceRow): boolean {
  const titleZh = normalize(row.titleZh)
  if (!titleZh || isBangumiTitlePlaceholder(titleZh, row.id)) return false

  const titleJa = normalize(row.titleJaRaw)
  if (!titleJa) return true
  return titleZh !== titleJa
}

export function hasBangumiBaseJaContent(row: BangumiTranslationSourceRow): boolean {
  const titleJa = normalize(row.titleJaRaw) || normalize(row.titleOriginal)
  if (!titleJa || isBangumiTitlePlaceholder(titleJa, row.id)) return false

  const titleZh = normalize(row.titleZh)
  return (
    !titleZh ||
    titleJa !== titleZh ||
    hasJapaneseScript(titleJa) ||
    Boolean(normalize(row.titleOriginal))
  )
}

export function hasBangumiBaseEnContent(row: BangumiTranslationSourceRow): boolean {
  return hasEnglishScript(row.titleEnglish)
}

function buildBangumiLocalizedContent(
  row: BangumiTranslationSourceRow,
  language: MapTranslationTargetLanguage
): BangumiLocalizedContent | null {
  const i18n = findBangumiI18n(row, language)
  const description = normalize(i18n?.description) || normalize(row.description)
  const city = normalize(i18n?.city) || normalize(row.city)

  let title = normalize(i18n?.title)
  if (!title) {
    if (language === 'zh' && hasBangumiBaseZhContent(row)) {
      title = normalize(row.titleZh)
    } else if (language === 'en' && hasBangumiBaseEnContent(row)) {
      title = normalize(row.titleEnglish)
    } else if (language === 'ja' && hasBangumiBaseJaContent(row)) {
      title = normalize(row.titleJaRaw) || normalize(row.titleOriginal)
    }
  }

  if (!title) return null
  return {
    title,
    description: description || null,
    city: city || null,
  }
}

function buildBangumiRawFallbackContent(
  row: BangumiTranslationSourceRow
): BangumiLocalizedContent {
  const title =
    normalize(row.titleZh) ||
    normalize(row.titleJaRaw) ||
    normalize(row.titleEnglish) ||
    normalize(row.titleOriginal)
  const description = normalize(row.description)
  const city = normalize(row.city)
  return {
    title,
    description: description || null,
    city: city || null,
  }
}

export function getBangumiApprovedLanguages(
  row: BangumiTranslationSourceRow,
  targetLanguages: readonly MapTranslationTargetLanguage[] = MAP_TRANSLATION_TARGET_LANGUAGES
): Set<MapTranslationTargetLanguage> {
  const out = new Set<MapTranslationTargetLanguage>()
  for (const language of targetLanguages) {
    if (buildBangumiLocalizedContent(row, language)) {
      out.add(language)
    }
  }
  return out
}

function getBangumiPriority(
  targetLanguage: MapTranslationTargetLanguage
): MapTranslationTargetLanguage[] {
  if (targetLanguage === 'zh') return ['en', 'ja', 'zh']
  if (targetLanguage === 'en') return ['zh', 'ja', 'en']
  return ['zh', 'en', 'ja']
}

export function selectBangumiSourceForTarget(
  row: BangumiTranslationSourceRow,
  targetLanguage: MapTranslationTargetLanguage
): LocalizedSourceResult<BangumiLocalizedContent> {
  for (const language of getBangumiPriority(targetLanguage)) {
    if (language === targetLanguage) continue
    const sourceContent = buildBangumiLocalizedContent(row, language)
    if (!sourceContent) continue
    return {
      sourceLanguage: language,
      sourceContent,
      sourceHash: buildBangumiSourceHashFromContent(sourceContent),
    }
  }

  const fallback = buildBangumiRawFallbackContent(row)
  return {
    sourceLanguage: 'und',
    sourceContent: fallback,
    sourceHash: buildBangumiSourceHashFromContent(fallback),
  }
}

export function getBangumiStoredSourceHash(
  row: BangumiTranslationSourceRow,
  language: MapTranslationTargetLanguage
): string | null {
  return normalize(findBangumiI18n(row, language)?.sourceHash) || null
}

export function hasPointBaseZhContent(row: PointTranslationSourceRow): boolean {
  return Boolean(normalize(row.nameZh))
}

export function hasPointBaseEnContent(row: PointTranslationSourceRow): boolean {
  return hasEnglishScript(row.name)
}

export function hasPointBaseJaContent(row: PointTranslationSourceRow): boolean {
  const name = normalize(row.name)
  if (!name || hasEnglishScript(name)) return false

  const nameZh = normalize(row.nameZh)
  return !nameZh || name !== nameZh || hasJapaneseScript(name)
}

function buildPointLocalizedContent(
  row: PointTranslationSourceRow,
  language: MapTranslationTargetLanguage
): PointLocalizedContent | null {
  const i18n = findPointI18n(row, language)
  const note = normalize(i18n?.note) || normalize(row.mark)

  let name = normalize(i18n?.name)
  if (!name) {
    if (language === 'zh' && hasPointBaseZhContent(row)) {
      name = normalize(row.nameZh)
    } else if (language === 'en' && hasPointBaseEnContent(row)) {
      name = normalize(row.name)
    } else if (language === 'ja' && hasPointBaseJaContent(row)) {
      name = normalize(row.name)
    }
  }

  if (!name) return null
  return {
    name,
    note: note || null,
  }
}

function buildPointRawFallbackContent(
  row: PointTranslationSourceRow
): PointLocalizedContent {
  const name = normalize(row.nameZh) || normalize(row.name)
  const note = normalize(row.mark)
  return {
    name,
    note: note || null,
  }
}

export function getPointApprovedLanguages(
  row: PointTranslationSourceRow,
  targetLanguages: readonly MapTranslationTargetLanguage[] = MAP_TRANSLATION_TARGET_LANGUAGES
): Set<MapTranslationTargetLanguage> {
  const out = new Set<MapTranslationTargetLanguage>()
  for (const language of targetLanguages) {
    if (buildPointLocalizedContent(row, language)) {
      out.add(language)
    }
  }
  return out
}

function getPointPriority(
  targetLanguage: MapTranslationTargetLanguage
): MapTranslationTargetLanguage[] {
  if (targetLanguage === 'zh') return ['en', 'ja', 'zh']
  if (targetLanguage === 'en') return ['zh', 'ja', 'en']
  return ['zh', 'en', 'ja']
}

export function selectPointSourceForTarget(
  row: PointTranslationSourceRow,
  targetLanguage: MapTranslationTargetLanguage
): LocalizedSourceResult<PointLocalizedContent> {
  for (const language of getPointPriority(targetLanguage)) {
    if (language === targetLanguage) continue
    const sourceContent = buildPointLocalizedContent(row, language)
    if (!sourceContent) continue
    return {
      sourceLanguage: language,
      sourceContent,
      sourceHash: buildPointSourceHashFromContent(sourceContent),
    }
  }

  const fallback = buildPointRawFallbackContent(row)
  return {
    sourceLanguage: 'und',
    sourceContent: fallback,
    sourceHash: buildPointSourceHashFromContent(fallback),
  }
}

export function getPointStoredSourceHash(
  row: PointTranslationSourceRow,
  language: MapTranslationTargetLanguage
): string | null {
  return normalize(findPointI18n(row, language)?.sourceHash) || null
}
