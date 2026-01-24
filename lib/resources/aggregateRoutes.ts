import { cache } from 'react'
import { extractSeichiRouteEmbedsFromTipTapJson } from '@/lib/route/extract'
import { parseSeichiRouteEmbedV1 } from '@/lib/route/schema'
import { extractLatLngFromGoogleMapsUrl, type LatLng } from '@/lib/route/google'
import { getAllAnime } from '@/lib/anime/getAllAnime'
import { getDefaultPublicArticleRepo } from '@/lib/posts/defaults'
import type {
  ResourceAnimeGroup,
  ResourceArticleForRoutes,
  ResourceRoutePreview,
  ResourceRouteSpot,
} from './types'

function hash32(input: string): number {
  let h = 0
  for (let i = 0; i < input.length; i++) {
    h = (h * 31 + input.charCodeAt(i)) >>> 0
  }
  return h
}

function toIdSegment(input: string): string {
  const raw = String(input || '').trim()
  if (!raw) return 'x'
  const lowered = raw.toLowerCase()
  const normalized = lowered.replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '')
  if (normalized) return normalized
  return `x${hash32(raw).toString(36)}`
}

function routeKeyFor(articleSlug: string, routeId: string): string {
  return `${String(articleSlug || '').trim()}::${String(routeId || '').trim()}`
}

export function routeAnchorIdFor(routeKey: string): string {
  const h = hash32(routeKey).toString(36)
  const safe = toIdSegment(routeKey)
  return `route-${safe}-${h}`
}

function spotKeyFor(spot: { googleMapsUrl?: string; lat?: number; lng?: number; name_zh?: string; name?: string }, idx: number): string {
  const url = typeof spot.googleMapsUrl === 'string' ? spot.googleMapsUrl.trim() : ''
  if (url) return `u${hash32(url).toString(36)}`
  if (typeof spot.lat === 'number' && typeof spot.lng === 'number') {
    return `c${spot.lat.toFixed(6)}_${spot.lng.toFixed(6)}`
  }
  const name = String(spot.name_zh || spot.name || '').trim()
  if (name) return `n${hash32(name).toString(36)}_${idx + 1}`
  return `i${idx + 1}`
}

function spotLabel(spot: { name_zh?: string; name?: string }, order: number): string {
  const zh = typeof spot.name_zh === 'string' ? spot.name_zh.trim() : ''
  const name = typeof spot.name === 'string' ? spot.name.trim() : ''
  return zh || name || `Spot ${order}`
}

function toResourceSpot(spot: any, idx: number): ResourceRouteSpot {
  const order = idx + 1
  const label = spotLabel(spot || {}, order)
  const googleMapsUrl = typeof spot?.googleMapsUrl === 'string' ? spot.googleMapsUrl.trim() : undefined
  const lat = typeof spot?.lat === 'number' ? spot.lat : undefined
  const lng = typeof spot?.lng === 'number' ? spot.lng : undefined

  return {
    order,
    spotKey: spotKeyFor({ googleMapsUrl, lat, lng, name_zh: spot?.name_zh, name: spot?.name }, idx),
    label,
    name_zh: typeof spot?.name_zh === 'string' ? spot.name_zh.trim() : undefined,
    name: typeof spot?.name === 'string' ? spot.name.trim() : undefined,
    name_ja: typeof spot?.name_ja === 'string' ? spot.name_ja.trim() : undefined,
    nearestStation_zh: typeof spot?.nearestStation_zh === 'string' ? spot.nearestStation_zh.trim() : undefined,
    nearestStation_ja: typeof spot?.nearestStation_ja === 'string' ? spot.nearestStation_ja.trim() : undefined,
    animeScene: typeof spot?.animeScene === 'string' ? spot.animeScene.trim() : undefined,
    googleMapsUrl,
    lat,
    lng,
    photoTip: typeof spot?.photoTip === 'string' ? spot.photoTip.trim() : undefined,
    note: typeof spot?.note === 'string' ? spot.note.trim() : undefined,
  }
}

export function pickPreviewSpots(spots: ResourceRouteSpot[], maxPoints: number): ResourceRouteSpot[] {
  const n = spots.length
  const cap = Math.max(2, Math.trunc(maxPoints || 0))
  if (n <= cap) return spots
  const picked: ResourceRouteSpot[] = []
  for (let i = 0; i < cap; i++) {
    const t = cap === 1 ? 0 : i / (cap - 1)
    const idx = Math.min(n - 1, Math.max(0, Math.round(t * (n - 1))))
    const s = spots[idx]!
    if (!picked.some((p) => p.order === s.order && p.spotKey === s.spotKey)) picked.push(s)
  }
  return picked
}

export function resolveSpotLatLng(spot: ResourceRouteSpot): LatLng | null {
  if (typeof spot.lat === 'number' && typeof spot.lng === 'number') return { lat: spot.lat, lng: spot.lng }
  if (spot.googleMapsUrl) return extractLatLngFromGoogleMapsUrl(spot.googleMapsUrl)
  return null
}

export function extractResourceRoutesFromArticles(articles: ResourceArticleForRoutes[]): ResourceRoutePreview[] {
  const out: ResourceRoutePreview[] = []

  for (const a of articles) {
    const slug = String(a.slug || '').trim()
    const title = String(a.title || '').trim()
    if (!slug || !title) continue

    const animeIds = Array.isArray(a.animeIds) ? a.animeIds.map((x) => String(x || '').trim()).filter(Boolean) : []

    const embeds = extractSeichiRouteEmbedsFromTipTapJson(a.contentJson)
    const primary = embeds[0]
    if (!primary?.id) continue

    const parsed = parseSeichiRouteEmbedV1(primary.route)
    if (!parsed.ok) continue

    const routeId = String(primary.id).trim()
    const routeKey = routeKeyFor(slug, routeId)
    const routeAnchorId = routeAnchorIdFor(routeKey)
    const routeTitle = String(parsed.value.title || '').trim() || `${title} 路线`

    const spots = parsed.value.spots.map((s, idx) => toResourceSpot(s, idx))
    const previewSpots = pickPreviewSpots(spots, 8)

    out.push({
      routeKey,
      routeAnchorId,
      articleSlug: slug,
      articleTitle: title,
      animeIds,
      city: a.city,
      routeId,
      routeTitle,
      route: parsed.value,
      previewSpots,
      spots,
    })
  }

  return out
}

export function groupResourceRoutesByAnime(routes: ResourceRoutePreview[], animeMeta: Map<string, { name: string; cover: string | null }>): ResourceAnimeGroup[] {
  const byAnime = new Map<string, ResourceRoutePreview[]>()
  for (const r of routes) {
    const ids = r.animeIds.length ? r.animeIds : ['unknown']
    for (const id of ids) {
      if (!byAnime.has(id)) byAnime.set(id, [])
      byAnime.get(id)!.push(r)
    }
  }

  const groups: ResourceAnimeGroup[] = []
  for (const [animeId, list] of byAnime) {
    const meta = animeMeta.get(animeId)
    groups.push({
      animeId,
      animeName: meta?.name || animeId,
      cover: meta?.cover ?? null,
      routeCount: list.length,
      routes: [...list].sort((a, b) => a.routeTitle.localeCompare(b.routeTitle)),
    })
  }

  return groups.sort((a, b) => {
    if (a.animeId === 'unknown' && b.animeId !== 'unknown') return 1
    if (b.animeId === 'unknown' && a.animeId !== 'unknown') return -1
    if (a.routeCount !== b.routeCount) return b.routeCount - a.routeCount
    return a.animeName.localeCompare(b.animeName)
  })
}

export const getResourceRouteGroups = cache(async () => {
  try {
    const repo = await getDefaultPublicArticleRepo()
    if (!repo) return [] as ResourceAnimeGroup[]

    const published = await repo.listByStatus('published').catch((err) => {
      console.error('[resources] listByStatus(published) failed', err)
      return []
    })

    const articles: ResourceArticleForRoutes[] = (published as any[]).map((a) => ({
      slug: String(a?.slug || '').trim(),
      title: String(a?.title || '').trim(),
      animeIds: Array.isArray(a?.animeIds) ? a.animeIds : [],
      city: typeof a?.city === 'string' ? a.city : undefined,
      contentJson: (a as any)?.contentJson ?? null,
    }))

    const routes = extractResourceRoutesFromArticles(articles)
    const animeList = await getAllAnime().catch((err) => {
      console.error('[resources] getAllAnime failed', err)
      return []
    })

    const animeMeta = new Map<string, { name: string; cover: string | null }>()
    for (const a of animeList) {
      const id = String(a?.id || '').trim()
      if (!id) continue
      animeMeta.set(id, { name: String(a?.name || id), cover: a?.cover ?? null })
    }

    return groupResourceRoutesByAnime(routes, animeMeta)
  } catch (err) {
    console.error('[resources] route directory failed', err)
    return [] as ResourceAnimeGroup[]
  }
})

export function getGoogleStaticMapApiKey(): string | null {
  const key =
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_STATIC_API_KEY ||
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ||
    process.env.GOOGLE_MAPS_STATIC_API_KEY ||
    ''
  const trimmed = String(key || '').trim()
  return trimmed ? trimmed : null
}
