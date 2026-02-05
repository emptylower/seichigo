import SerpApi from 'google-search-results-nodejs'

export interface SerpApiParams {
  q: string
  num: number
  hl: string
  gl: string
}

export interface SerpApiResult {
  link: string
  title: string
  position?: number
}

export function createSerpClient() {
  const apiKey = process.env.SERPAPI_KEY
  if (!apiKey) {
    throw new Error('Missing SERPAPI_KEY environment variable')
  }
  return new SerpApi.GoogleSearch(apiKey)
}

export async function searchGoogle(keyword: string, lang: string): Promise<SerpApiResult[]> {
  const search = createSerpClient()
  
  const params: SerpApiParams = {
    q: keyword,
    num: 100,
    hl: lang,
    gl: lang === 'zh' ? 'cn' : lang === 'ja' ? 'jp' : 'us'
  }
  
  return new Promise((resolve, reject) => {
    try {
      search.json(params as unknown as Record<string, unknown>, (data: any) => {
        if (data?.error) {
          reject(new Error(data.error))
          return
        }
        resolve(data?.organic_results || [])
      })
    } catch (err) {
      reject(err)
    }
  })
}
