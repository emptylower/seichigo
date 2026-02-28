const ANILIST_API_URL = 'https://graphql.anilist.co'

const ANILIST_QUERY = `
  query ($search: String) {
    Page(perPage: 5) {
      media(search: $search, type: ANIME) {
        id
        title {
          romaji
          english
          native
        }
        synonyms
      }
    }
  }
`

export interface AniListMedia {
  id: number
  title: {
    romaji: string | null
    english: string | null
    native: string | null
  }
  synonyms: string[]
}

/**
 * Fetch anime metadata from AniList GraphQL API.
 * Returns the best-matching media entry or null if no results.
 * Does NOT handle retries — callers should implement retry logic.
 */
export async function fetchAniListMetadata(
  searchKey: string,
): Promise<AniListMedia | null> {
  if (!searchKey.trim()) return null

  const response = await fetch(ANILIST_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      query: ANILIST_QUERY,
      variables: { search: searchKey },
    }),
  })

  if (!response.ok) {
    const err = new Error(`AniList API error (${response.status})`)
    ;(err as any).status = response.status
    throw err
  }

  const data = (await response.json()) as {
    data?: {
      Page?: {
        media?: AniListMedia[]
      }
    }
  }

  const mediaList = data?.data?.Page?.media
  if (!mediaList || mediaList.length === 0) return null

  return mediaList[0]!
}
