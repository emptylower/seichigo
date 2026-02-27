import type { AnitabiBangumiCard, AnitabiBangumiDTO, AnitabiMapTab } from '../types'

export type CachedCardsPayload = {
  datasetVersion: string
  tab: AnitabiMapTab
  cards: AnitabiBangumiCard[]
  cachedAt: number
}

export type CachedBangumiDetail = {
  datasetVersion: string
  bangumiId: number
  detail: AnitabiBangumiDTO
  cachedAt: number
}

export interface CacheStore {
  getCards(tab: AnitabiMapTab): Promise<CachedCardsPayload | null>
  putCards(tab: AnitabiMapTab, payload: CachedCardsPayload): Promise<void>
  getDetail(bangumiId: number): Promise<CachedBangumiDetail | null>
  putDetail(bangumiId: number, payload: CachedBangumiDetail): Promise<void>
  getVersion(): Promise<string | null>
  clear(): Promise<void>
}

export type LoadProgress = {
  phase: 'idle' | 'loading' | 'done'
  loaded: number
  total: number | null
  percent: number
}

export type BulkCardsResponse = {
  datasetVersion: string
  items: AnitabiBangumiCard[]
  total: number
}
