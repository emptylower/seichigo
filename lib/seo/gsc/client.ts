import { GoogleAuth } from 'google-auth-library'
import { readFile } from 'node:fs/promises'

const GSC_API_BASE = 'https://www.googleapis.com/webmasters/v3'

export interface SearchAnalyticsRow {
  keys: string[]
  clicks: number
  impressions: number
  ctr: number
  position: number
}

export type GscDimension = 'query' | 'page' | 'date'

export interface GscSearchAnalyticsQueryParams {
  siteUrl: string
  requestBody: {
    startDate: string
    endDate: string
    dimensions: GscDimension[]
    dataState: 'all' | 'final'
    searchType: string
    rowLimit: number
  }
}

export interface GscSitesListResponse {
  siteEntry?: Array<{ siteUrl?: string; permissionLevel?: string }>
}

export interface GscClient {
  searchanalytics: {
    query(params: GscSearchAnalyticsQueryParams): Promise<{ data: { rows?: SearchAnalyticsRow[] } }>
  }
  sites: {
    list(): Promise<{ data: GscSitesListResponse }>
  }
}

export async function createGscClient(): Promise<GscClient> {
  const credJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
  const credPath = process.env.GOOGLE_SERVICE_ACCOUNT_PATH

  if (!credJson && !credPath) {
    throw new Error(
      'Missing GSC credentials: set GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_SERVICE_ACCOUNT_PATH'
    )
  }

  let credentials
  if (credJson) {
    try {
      credentials = JSON.parse(credJson)
    } catch (err) {
      throw new Error(
        `Failed to parse GOOGLE_SERVICE_ACCOUNT_JSON: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  } else {
    try {
      const raw = await readFile(credPath!, 'utf8')
      credentials = JSON.parse(raw)
    } catch (err) {
      throw new Error(
        `Failed to load credentials from ${credPath}: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }

  const auth = new GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
  })

  async function gscFetch<T>(path: string, init?: RequestInit): Promise<T> {
    const token = await auth.getAccessToken()
    const response = await fetch(`${GSC_API_BASE}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        ...(init?.headers ?? {}),
      },
    })
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(
        `GSC API ${response.status} ${response.statusText}: ${body.slice(0, 500)}`
      )
    }
    return (await response.json()) as T
  }

  return {
    searchanalytics: {
      query: async ({ siteUrl, requestBody }) => {
        const data = await gscFetch<{ rows?: SearchAnalyticsRow[] }>(
          `/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
          { method: 'POST', body: JSON.stringify(requestBody) }
        )
        return { data }
      },
    },
    sites: {
      list: async () => ({
        data: await gscFetch<GscSitesListResponse>('/sites'),
      }),
    },
  }
}

export async function fetchSearchAnalytics(
  client: GscClient,
  siteUrl: string,
  startDate: string,
  endDate: string,
  dimensions: GscDimension[]
): Promise<SearchAnalyticsRow[]> {
  const response = await client.searchanalytics.query({
    siteUrl,
    requestBody: {
      startDate,
      endDate,
      dimensions,
      // Default is "final" in many clients; for small sites recent days can be "fresh"
      // only, which would produce zero rows if we don't include them.
      dataState: 'all',
      searchType: 'web',
      rowLimit: 25000,
    },
  })

  return (response.data.rows || []) as SearchAnalyticsRow[]
}
