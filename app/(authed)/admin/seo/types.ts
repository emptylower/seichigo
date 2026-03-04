export type Keyword = {
  id: string
  keyword: string
  language: string
  category: string
  priority: number
  isActive: boolean
  rankHistory: Array<{
    position: number | null
    checkedAt: Date
  }>
}

export type TopQuery = {
  query: string
  _sum: {
    clicks: number | null
    impressions: number | null
  }
}

export type SerpUsage = {
  count: number
} | null

export type Props = {
  keywords: Keyword[]
  topQueries: TopQuery[]
  serpUsage: SerpUsage
}

export type KeywordDraft = {
  keyword: string
  priority: number
  isActive: boolean
}

export const emptyDraft: KeywordDraft = {
  keyword: '',
  priority: 0,
  isActive: true,
}

export type BulkImportResult = {
  inserted: number
  updated: number
  total: number
  errors: Array<{ line: number; raw: string; reason: string }>
}

export type RankCheckResult = {
  keyword: string
  position: number | null
  url: string | null
  quota?: { used: number; limit: number }
}

export type RankCheckResponse = {
  message?: string
  result?: RankCheckResult
}

export type BulkCheckItem = {
  keywordId: string
  keyword: string
  priority: number
  ok: boolean
  position: number | null
  message: string
}

export type BulkCheckReport = {
  startedAt: number
  finishedAt: number
  total: number
  success: number
  failed: number
  cancelled: boolean
  items: BulkCheckItem[]
}
