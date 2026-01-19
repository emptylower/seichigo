import type { ArticleRepo } from '@/lib/article/repo'
import { getDefaultPublicArticleRepo } from '@/lib/posts/defaults'
import { extractSeichiRouteEmbedsFromTipTapJson } from '@/lib/route/extract'
import type { SeichiRouteSpotV1 } from '@/lib/route/schema'
import type { AggregatedSpot } from './types'

export type AggregateSpotsOptions = {
  filterByAnimeIds?: string[]
  filterByCities?: string[]
  articleRepo?: Pick<ArticleRepo, 'listByStatus'>
}

function normalizeLower(input: unknown): string {
  return typeof input === 'string' ? input.trim().toLowerCase() : ''
}

function matchesAny(value: string, candidates: string[]): boolean {
  if (!value) return false
  const v = value.toLowerCase()
  return candidates.some((c) => c && c.toLowerCase() === v)
}

function spotToAggregated(spot: SeichiRouteSpotV1, idx: number, meta: { slug: string; routeId: string; animeIds: string[]; city: string }): AggregatedSpot {
  return {
    name_zh: String(spot.name_zh || '').trim() || String(spot.name || '').trim() || `Spot ${idx + 1}`,
    name: typeof spot.name === 'string' ? spot.name.trim() : undefined,
    name_ja: typeof spot.name_ja === 'string' ? spot.name_ja.trim() : undefined,
    nearestStation_zh: typeof spot.nearestStation_zh === 'string' ? spot.nearestStation_zh.trim() : undefined,
    nearestStation_ja: typeof spot.nearestStation_ja === 'string' ? spot.nearestStation_ja.trim() : undefined,
    animeScene: typeof spot.animeScene === 'string' ? spot.animeScene.trim() : undefined,
    googleMapsUrl: typeof spot.googleMapsUrl === 'string' ? spot.googleMapsUrl.trim() : undefined,
    lat: typeof spot.lat === 'number' ? spot.lat : undefined,
    lng: typeof spot.lng === 'number' ? spot.lng : undefined,
    photoTip: typeof spot.photoTip === 'string' ? spot.photoTip.trim() : undefined,
    note: typeof (spot as any).note === 'string' ? String((spot as any).note).trim() : undefined,
    fromArticleSlug: meta.slug,
    fromRouteId: meta.routeId,
    animeIds: meta.animeIds,
    city: meta.city,
  }
}

export async function aggregateSpots(options?: AggregateSpotsOptions): Promise<AggregatedSpot[]> {
  const filterAnime = (options?.filterByAnimeIds || []).map((x) => String(x || '').trim()).filter(Boolean)
  const filterCities = (options?.filterByCities || []).map((x) => String(x || '').trim()).filter(Boolean)

  const repo = options?.articleRepo ?? (await getDefaultPublicArticleRepo())
  if (!repo) return []

  const published = await repo.listByStatus('published').catch(() => [])

  const out: AggregatedSpot[] = []
  const seen = new Set<string>()

  for (const a of published as any[]) {
    const slug = String(a?.slug || '').trim()
    const city = String(a?.city || '').trim()
    const animeIds = Array.isArray(a?.animeIds) ? (a.animeIds as string[]).map((x) => String(x || '').trim()).filter(Boolean) : []

    if (filterAnime.length) {
      const hit = animeIds.some((id) => matchesAny(id, filterAnime))
      if (!hit) continue
    }

    if (filterCities.length) {
      const hit = matchesAny(city, filterCities) || matchesAny(normalizeLower(city), filterCities)
      if (!hit) continue
    }

    const routes = extractSeichiRouteEmbedsFromTipTapJson(a?.contentJson)
    for (const r of routes) {
      const routeId = String(r.id || '').trim()
      for (let i = 0; i < r.route.spots.length; i++) {
        const s = r.route.spots[i]!
        const item = spotToAggregated(s, i, { slug, routeId, animeIds, city })

        const dedupeKey = (
          (item.googleMapsUrl && item.googleMapsUrl.toLowerCase()) ||
          (typeof item.lat === 'number' && typeof item.lng === 'number' ? `${item.lat.toFixed(6)},${item.lng.toFixed(6)}` : '') ||
          `${slug}:${routeId}:${i}`
        )

        if (seen.has(dedupeKey)) continue
        seen.add(dedupeKey)
        out.push(item)
      }
    }
  }

  return out
}
