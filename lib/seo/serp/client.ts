// @ts-ignore - no types available for google-search-results-nodejs
import { getJson } from 'google-search-results-nodejs'

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
  return apiKey
}

export async function searchGoogle(keyword: string, lang: string): Promise<SerpApiResult[]> {
  const apiKey = createSerpClient()
  
  const params: SerpApiParams = {
    q: keyword,
    num: 100,
    hl: lang,
    gl: lang === 'zh' ? 'cn' : lang === 'ja' ? 'jp' : 'us'
  }
  
  return new Promise((resolve, reject) => {
    getJson('google', apiKey, params, (data: any) => {
      if (data.error) {
        reject(new Error(data.error))
      } else {
        resolve(data.organic_results || [])
      }
    })
  })
}
