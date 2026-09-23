import type { Prisma } from '@prisma/client'
import { createPlaceDetails, type PlaceIntro, type PlaceIntroLang } from '@/lib/googlePlaces/details'
import { getCachedRoutePayload, routeLegCacheKey, setCachedRoutePayload } from './legCache'

// ---------------------------------------------------------------------------
// 谷歌点位介绍的查找入口（B1.1 A3）：Place Details + RouteLegCache 表缓存
// （key `place-intro|<lang>|<placeId>`，TTL 7 天）。key 的读取方式照
// lib/googlePlaces/api.ts：GOOGLE_DIRECTIONS_API_KEY || GOOGLE_MAPS_API_KEY。
// ---------------------------------------------------------------------------

function isPlaceIntro(value: unknown): value is PlaceIntro {
  if (typeof value !== 'object' || value === null) return false
  const shape = value as { name?: unknown; openingHours?: unknown }
  return typeof shape.name === 'string' && Array.isArray(shape.openingHours)
}

export function createPlaceIntroLookup(opts?: { apiKey?: string; fetchImpl?: typeof fetch }) {
  const apiKey = opts?.apiKey ?? (process.env.GOOGLE_DIRECTIONS_API_KEY || process.env.GOOGLE_MAPS_API_KEY || '')
  const details = createPlaceDetails({ apiKey, ...(opts?.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}) })

  return async function lookupPlaceIntro(googlePlaceId: string, lang: PlaceIntroLang): Promise<PlaceIntro | null> {
    const key = routeLegCacheKey(`place-intro|${lang}|${googlePlaceId}`)
    const cached = await getCachedRoutePayload(key)
    if (isPlaceIntro(cached)) return cached

    const intro = await details.getPlaceIntro(googlePlaceId, lang)
    if (intro) await setCachedRoutePayload(key, intro as Prisma.InputJsonValue)
    return intro
  }
}
