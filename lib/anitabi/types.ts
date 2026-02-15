export type AnitabiMapTab = 'latest' | 'recent' | 'hot' | 'nearby'

export type AnitabiDatasetVersion = string

export type AnitabiBangumiCard = {
  id: number
  title: string
  titleZh: string | null
  cat: string | null
  city: string | null
  cover: string | null
  color: string | null
  pointsLength: number
  imagesLength: number
  sourceModifiedMs: number | null
  mapEnabled: boolean
  geo: [number, number] | null
  zoom: number | null
  nearestDistanceMeters: number | null
}

export type AnitabiPointDTO = {
  id: string
  bangumiId: number
  name: string
  nameZh: string | null
  geo: [number, number] | null
  ep: string | null
  s: string | null
  image: string | null
  origin: string | null
  originUrl: string | null
  originLink: string | null
  density: number | null
  mark: string | null
}

export type AnitabiContributorDTO = {
  id: string
  name: string | null
  avatar: string | null
  link: string | null
  count: number
}

export type AnitabiBangumiDTO = {
  card: AnitabiBangumiCard
  description: string | null
  tags: string[]
  points: AnitabiPointDTO[]
  customEpNames: Record<string, string>
  theme: unknown
  contributors: AnitabiContributorDTO[]
}

export type AnitabiChangelogDTO = {
  id: string
  date: string
  title: string
  body: string
  links: Array<{ label: string; url: string }>
}

export type AnitabiBootstrapDTO = {
  datasetVersion: string
  tab: AnitabiMapTab
  tabs: Array<{ key: AnitabiMapTab; label: string }>
  facets: {
    cities: string[]
  }
  cards: AnitabiBangumiCard[]
  changelog: AnitabiChangelogDTO[]
}

export type AnitabiSearchResultDTO = {
  bangumi: AnitabiBangumiCard[]
  points: AnitabiPointDTO[]
  cities: string[]
}

export type AnitabiSyncMode = 'full' | 'delta' | 'dryRun'

export type AnitabiSyncReport = {
  runId: string
  mode: AnitabiSyncMode
  status: 'ok' | 'failed'
  datasetVersion: string | null
  scanned: number
  changed: number
  message?: string
}
