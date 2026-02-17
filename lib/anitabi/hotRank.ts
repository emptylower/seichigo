type AniListMediaRow = {
  title?: {
    romaji?: string | null
    english?: string | null
    native?: string | null
  } | null
  synonyms?: string[] | null
  trending?: number | null
  popularity?: number | null
  favourites?: number | null
  averageScore?: number | null
  startDate?: {
    year?: number | null
  } | null
}

type HotRankCandidate = {
  score: number
  year: number | null
}

export type AnitabiHotSnapshot = {
  generatedAt: string
  windowStart: string
  windowDays: number
  exactIndex: Map<string, HotRankCandidate[]>
  baseIndex: Map<string, HotRankCandidate[]>
}

export type HotScoreSignal = {
  titles: string[]
  years?: number[]
}

type AniListGraphQLResponse = {
  data?: {
    Page?: {
      pageInfo?: {
        hasNextPage?: boolean | null
      } | null
      media?: AniListMediaRow[] | null
    } | null
  } | null
  errors?: Array<{ message?: string }>
}

const ANILIST_ENDPOINT = 'https://graphql.anilist.co'
const DEFAULT_WINDOW_DAYS = 90
const DEFAULT_CACHE_MINUTES = 360
const DEFAULT_MAX_PAGES = 3
const PAGE_SIZE = 50
const REQUEST_TIMEOUT_MS = 4500
const MAX_ALIASES_PER_ROW = 20

let snapshotCache: { expiresAtMs: number; value: AnitabiHotSnapshot | null } | null = null
let inflightSnapshot: Promise<AnitabiHotSnapshot | null> | null = null

function toFiniteNumber(input: unknown): number | null {
  const n = Number(input)
  if (!Number.isFinite(n)) return null
  return n
}

function clampIntValue(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, Math.trunc(value)))
}

function clampWindowDaysFromEnv(): number {
  const raw = toFiniteNumber(process.env.ANITABI_HOT_WINDOW_DAYS)
  if (raw == null) return DEFAULT_WINDOW_DAYS
  return clampIntValue(raw, 30, 180)
}

function clampCacheMinutesFromEnv(): number {
  const raw = toFiniteNumber(process.env.ANITABI_HOT_CACHE_MINUTES)
  if (raw == null) return DEFAULT_CACHE_MINUTES
  return clampIntValue(raw, 5, 1440)
}

function clampMaxPagesFromEnv(): number {
  const raw = toFiniteNumber(process.env.ANITABI_HOT_ANILIST_MAX_PAGES)
  if (raw == null) return DEFAULT_MAX_PAGES
  return clampIntValue(raw, 1, 8)
}

function addDays(base: Date, days: number): Date {
  return new Date(base.getTime() + days * 24 * 60 * 60 * 1000)
}

function toFuzzyDateInt(date: Date): number {
  const year = date.getUTCFullYear()
  const month = date.getUTCMonth() + 1
  const day = date.getUTCDate()
  return year * 10000 + month * 100 + day
}

function trimText(input: unknown): string {
  return String(input ?? '').trim()
}

function normalizeTitleForMatch(input: string): string {
  return input
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[()\[\]{}（）【】「」『』《》]/g, ' ')
    .replace(/[!-/:-@[-`{-~]/g, ' ')
    .replace(/[·・、。！？：；'"’“”`~…]/g, ' ')
    .replace(/\s+/g, '')
}

function stripSeasonWords(input: string): string {
  return input
    .normalize('NFKC')
    .replace(/第\s*\d+\s*(期|季|部|シーズン)/gi, ' ')
    .replace(/\bseason\s*\d+\b/gi, ' ')
    .replace(/\bpart\s*\d+\b/gi, ' ')
    .replace(/\bcour\s*\d+\b/gi, ' ')
    .replace(/\b(s|ss)\s*\d+\b/gi, ' ')
    .replace(/\b\d+(st|nd|rd|th)\s+season\b/gi, ' ')
    .replace(/\bfinal\s+season\b/gi, ' ')
}

function toBaseTitleKey(input: string): string {
  return normalizeTitleForMatch(stripSeasonWords(input))
}

function mediaHotScore(row: AniListMediaRow): number {
  const trending = Math.max(0, toFiniteNumber(row.trending) || 0)
  const popularity = Math.max(0, toFiniteNumber(row.popularity) || 0)
  const favourites = Math.max(0, toFiniteNumber(row.favourites) || 0)
  const averageScore = Math.max(0, toFiniteNumber(row.averageScore) || 0)
  return trending * 1000 + Math.log10(popularity + 10) * 180 + Math.log10(favourites + 10) * 120 + averageScore
}

function collectMediaTitles(row: AniListMediaRow): string[] {
  const out: string[] = []
  const dedup = new Set<string>()

  const push = (value: unknown) => {
    const text = trimText(value)
    if (!text) return
    if (dedup.has(text)) return
    dedup.add(text)
    out.push(text)
  }

  push(row.title?.native)
  push(row.title?.romaji)
  push(row.title?.english)
  for (const item of row.synonyms || []) {
    push(item)
    if (out.length >= MAX_ALIASES_PER_ROW) break
  }
  return out
}

function addCandidate(index: Map<string, HotRankCandidate[]>, key: string, candidate: HotRankCandidate) {
  if (!key) return
  const list = index.get(key)
  if (!list) {
    index.set(key, [candidate])
    return
  }
  list.push(candidate)
}

function sortAndTrimCandidates(index: Map<string, HotRankCandidate[]>) {
  for (const [key, list] of index.entries()) {
    list.sort((a, b) => b.score - a.score)
    if (list.length > 8) {
      index.set(key, list.slice(0, 8))
    }
  }
}

export function buildHotSnapshotFromAniListRows(rows: AniListMediaRow[], input: {
  generatedAt?: Date
  windowStart?: Date
  windowDays?: number
} = {}): AnitabiHotSnapshot {
  const generatedAt = input.generatedAt || new Date()
  const windowStart = input.windowStart || addDays(generatedAt, -DEFAULT_WINDOW_DAYS)
  const windowDays = clampIntValue(input.windowDays || DEFAULT_WINDOW_DAYS, 30, 180)
  const exactIndex = new Map<string, HotRankCandidate[]>()
  const baseIndex = new Map<string, HotRankCandidate[]>()

  for (const row of rows) {
    const score = mediaHotScore(row)
    if (!Number.isFinite(score) || score <= 0) continue
    const yearRaw = toFiniteNumber(row.startDate?.year)
    const year = yearRaw != null ? clampIntValue(yearRaw, 1900, 2200) : null
    const candidate: HotRankCandidate = { score, year }
    const titles = collectMediaTitles(row)
    for (const title of titles) {
      const exactKey = normalizeTitleForMatch(title)
      const baseKey = toBaseTitleKey(title)
      addCandidate(exactIndex, exactKey, candidate)
      addCandidate(baseIndex, baseKey, candidate)
    }
  }

  sortAndTrimCandidates(exactIndex)
  sortAndTrimCandidates(baseIndex)

  return {
    generatedAt: generatedAt.toISOString(),
    windowStart: windowStart.toISOString(),
    windowDays,
    exactIndex,
    baseIndex,
  }
}

function candidateYearAdjustment(candidateYear: number | null, years: number[]): number {
  if (!years.length) return 0
  if (candidateYear == null) return -20
  const nearest = years.reduce((prev, curr) => {
    const diff = Math.abs(curr - candidateYear)
    return Math.min(prev, diff)
  }, Number.POSITIVE_INFINITY)
  if (nearest === 0) return 80
  if (nearest === 1) return 25
  if (nearest >= 2) return -120
  return 0
}

function readCandidates(index: Map<string, HotRankCandidate[]>, keys: string[]): HotRankCandidate[] {
  const out: HotRankCandidate[] = []
  for (const key of keys) {
    const list = index.get(key)
    if (!list?.length) continue
    out.push(...list)
  }
  return out
}

function normalizeYearList(input: number[] | undefined): number[] {
  if (!Array.isArray(input)) return []
  const out: number[] = []
  const dedup = new Set<number>()
  for (const row of input) {
    const n = toFiniteNumber(row)
    if (n == null) continue
    const year = clampIntValue(n, 1900, 2200)
    if (dedup.has(year)) continue
    dedup.add(year)
    out.push(year)
    if (out.length >= 4) break
  }
  return out
}

function collectSignalKeys(signal: HotScoreSignal): { exact: string[]; base: string[] } {
  const exact: string[] = []
  const base: string[] = []
  const seenExact = new Set<string>()
  const seenBase = new Set<string>()

  for (const title of signal.titles || []) {
    const text = trimText(title)
    if (!text) continue
    const exactKey = normalizeTitleForMatch(text)
    const baseKey = toBaseTitleKey(text)
    if (exactKey && !seenExact.has(exactKey)) {
      seenExact.add(exactKey)
      exact.push(exactKey)
    }
    if (baseKey && !seenBase.has(baseKey)) {
      seenBase.add(baseKey)
      base.push(baseKey)
    }
  }

  return { exact, base }
}

export function resolveHotScore(snapshot: AnitabiHotSnapshot | null, signal: HotScoreSignal): number | null {
  if (!snapshot) return null
  const years = normalizeYearList(signal.years)
  const keys = collectSignalKeys(signal)
  if (!keys.exact.length && !keys.base.length) return null

  let bestScore: number | null = null
  for (const candidate of readCandidates(snapshot.exactIndex, keys.exact)) {
    const score = candidate.score + candidateYearAdjustment(candidate.year, years)
    if (bestScore == null || score > bestScore) bestScore = score
  }
  for (const candidate of readCandidates(snapshot.baseIndex, keys.base)) {
    const score = candidate.score * 0.92 + candidateYearAdjustment(candidate.year, years)
    if (bestScore == null || score > bestScore) bestScore = score
  }
  return bestScore
}

const ANILIST_RECENT_QUERY = `
query($page:Int!, $perPage:Int!, $startDateGreater:Int!, $startDateLesser:Int!) {
  Page(page:$page, perPage:$perPage) {
    pageInfo { hasNextPage }
    media(
      type: ANIME
      isAdult: false
      startDate_greater: $startDateGreater
      startDate_lesser: $startDateLesser
      sort: [TRENDING_DESC, POPULARITY_DESC]
    ) {
      title { romaji english native }
      synonyms
      trending
      popularity
      favourites
      averageScore
      startDate { year }
    }
  }
}
`

async function postAniListJson(body: unknown): Promise<AniListGraphQLResponse> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const res = await fetch(ANILIST_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': 'seichigo-map-hot/1.0',
      },
      body: JSON.stringify(body),
      cache: 'no-store',
      signal: controller.signal,
    })
    if (!res.ok) {
      throw new Error(`AniList request failed: ${res.status}`)
    }
    return (await res.json()) as AniListGraphQLResponse
  } finally {
    clearTimeout(timer)
  }
}

async function loadRecentAniListRows(now: Date): Promise<AniListMediaRow[]> {
  const windowDays = clampWindowDaysFromEnv()
  const maxPages = clampMaxPagesFromEnv()
  const windowStart = addDays(now, -windowDays)
  const startDateGreater = toFuzzyDateInt(windowStart)
  const startDateLesser = toFuzzyDateInt(now)

  const rows: AniListMediaRow[] = []

  for (let page = 1; page <= maxPages; page += 1) {
    const payload = {
      query: ANILIST_RECENT_QUERY,
      variables: {
        page,
        perPage: PAGE_SIZE,
        startDateGreater,
        startDateLesser,
      },
    }
    const json = await postAniListJson(payload)
    if (Array.isArray(json.errors) && json.errors.length > 0) {
      const message = trimText(json.errors[0]?.message) || 'Unknown AniList GraphQL error'
      throw new Error(message)
    }
    const pageNode = json.data?.Page
    const media = Array.isArray(pageNode?.media) ? pageNode?.media || [] : []
    if (!media.length) break
    rows.push(...media)
    if (!pageNode?.pageInfo?.hasNextPage) break
  }

  return rows
}

export async function getRecentHotSnapshot(now = new Date()): Promise<AnitabiHotSnapshot | null> {
  const nowMs = now.getTime()
  const cacheMinutes = clampCacheMinutesFromEnv()
  const expiresDelta = cacheMinutes * 60 * 1000

  if (snapshotCache && nowMs < snapshotCache.expiresAtMs) {
    return snapshotCache.value
  }
  if (inflightSnapshot) {
    return await inflightSnapshot
  }

  inflightSnapshot = (async () => {
    try {
      const rows = await loadRecentAniListRows(now)
      if (!rows.length) {
        snapshotCache = { value: null, expiresAtMs: nowMs + Math.min(expiresDelta, 15 * 60 * 1000) }
        return null
      }
      const windowStart = addDays(now, -clampWindowDaysFromEnv())
      const snapshot = buildHotSnapshotFromAniListRows(rows, {
        generatedAt: now,
        windowStart,
        windowDays: clampWindowDaysFromEnv(),
      })
      snapshotCache = { value: snapshot, expiresAtMs: nowMs + expiresDelta }
      return snapshot
    } catch (error) {
      console.warn('[anitabi/hotRank] failed to refresh recent hot snapshot', error)
      if (snapshotCache?.value) return snapshotCache.value
      snapshotCache = { value: null, expiresAtMs: nowMs + 10 * 60 * 1000 }
      return null
    } finally {
      inflightSnapshot = null
    }
  })()

  return await inflightSnapshot
}
