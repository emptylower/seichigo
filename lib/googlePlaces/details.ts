// ---------------------------------------------------------------------------
// Google Place Details（B1.1 A3）：按 googlePlaceId 拉地点介绍（名称/地址/
// 评分/简介/营业时间/网站/地图链接）。供行程本自定义点详情卡使用。
// 只请求文本字段，**不请求 photos**（照片走 place-photo 代理）。API key 只
// 出现在对 Google 的请求里，绝不进入任何返回给前端/落库的字段。
// ---------------------------------------------------------------------------

export type PlaceIntroLang = 'zh-CN' | 'en' | 'ja'

export type PlaceIntro = {
  name: string
  address: string | null
  rating: number | null
  userRatingsTotal: number | null
  summary: string | null
  openingHours: string[]
  website: string | null
  mapsUrl: string | null
}

export const PLACE_INTRO_LANGS: readonly PlaceIntroLang[] = ['zh-CN', 'en', 'ja'] as const

const DETAILS_FIELDS = 'name,formatted_address,rating,user_ratings_total,editorial_summary,opening_hours,website,url'
const DETAILS_FETCH_TIMEOUT_MS = 8_000

type DetailsApiBody = {
  status?: string
  result?: {
    name?: string
    formatted_address?: string
    rating?: number
    user_ratings_total?: number
    editorial_summary?: { overview?: unknown }
    opening_hours?: { weekday_text?: unknown }
    website?: unknown
    url?: unknown
  }
}

export function createPlaceDetails(deps: { apiKey: string; fetchImpl?: typeof fetch }) {
  const fetchImpl = deps.fetchImpl ?? fetch

  return {
    /** 上游无结果 / 配置缺失 / 网络失败 → null（由调用方决定 404 语义） */
    async getPlaceIntro(googlePlaceId: string, language: PlaceIntroLang): Promise<PlaceIntro | null> {
      if (!deps.apiKey) return null

      const params = new URLSearchParams({
        place_id: googlePlaceId,
        fields: DETAILS_FIELDS,
        language,
        key: deps.apiKey,
      })

      let body: DetailsApiBody | null = null
      try {
        const res = await fetchImpl(`https://maps.googleapis.com/maps/api/place/details/json?${params.toString()}`, {
          signal: AbortSignal.timeout(DETAILS_FETCH_TIMEOUT_MS),
        })
        if (!res.ok) return null
        body = (await res.json().catch(() => null)) as DetailsApiBody | null
      } catch {
        return null
      }

      if (!body || body.status !== 'OK' || !body.result) return null

      const result = body.result
      return {
        name: typeof result.name === 'string' && result.name ? result.name : googlePlaceId,
        address: typeof result.formatted_address === 'string' ? result.formatted_address : null,
        rating: typeof result.rating === 'number' ? result.rating : null,
        userRatingsTotal: typeof result.user_ratings_total === 'number' ? result.user_ratings_total : null,
        summary:
          typeof result.editorial_summary?.overview === 'string' ? result.editorial_summary.overview : null,
        openingHours: Array.isArray(result.opening_hours?.weekday_text)
          ? result.opening_hours.weekday_text.filter((line): line is string => typeof line === 'string')
          : [],
        website: typeof result.website === 'string' ? result.website : null,
        mapsUrl: typeof result.url === 'string' ? result.url : null,
      }
    },
  }
}
