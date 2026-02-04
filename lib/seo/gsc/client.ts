import { google } from 'googleapis'
import { readFile } from 'node:fs/promises'

export async function createGscClient() {
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

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
  })

  return google.webmasters({ version: 'v3', auth })
}

export interface SearchAnalyticsRow {
  keys: string[]
  clicks: number
  impressions: number
  ctr: number
  position: number
}

export async function fetchSearchAnalytics(
  client: ReturnType<typeof google.webmasters>,
  siteUrl: string,
  startDate: string,
  endDate: string
): Promise<SearchAnalyticsRow[]> {
  const response = await client.searchanalytics.query({
    siteUrl,
    requestBody: {
      startDate,
      endDate,
      dimensions: ['query', 'page', 'date'],
      // Default is "final" in many clients; for small sites recent days can be "fresh"
      // only, which would produce zero rows if we don't include them.
      dataState: 'all',
      searchType: 'web',
      rowLimit: 25000,
    },
  })

  return (response.data.rows || []) as SearchAnalyticsRow[]
}
