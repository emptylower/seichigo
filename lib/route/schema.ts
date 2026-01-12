import { z } from 'zod'

export type SeichiRouteSpotV1 = {
  name?: string
  name_zh?: string
  name_ja?: string
  nearestStation_zh?: string
  nearestStation_ja?: string
  animeScene?: string
  googleMapsUrl?: string
  lat?: number
  lng?: number
  photoTip?: string
  note?: string
}

export type SeichiRouteEmbedV1 = {
  version: 1
  title?: string
  spots: SeichiRouteSpotV1[]
}

export type ParseSeichiRouteEmbedResult =
  | { ok: true; value: SeichiRouteEmbedV1 }
  | { ok: false; error: string }

const spotSchema: z.ZodType<SeichiRouteSpotV1> = z
  .object({
    name: z.string().optional(),
    name_zh: z.string().optional(),
    name_ja: z.string().optional(),
    nearestStation_zh: z.string().optional(),
    nearestStation_ja: z.string().optional(),
    animeScene: z.string().optional(),
    googleMapsUrl: z.string().optional(),
    lat: z
      .preprocess(
        (v) => {
          if (typeof v === 'string') {
            const trimmed = v.trim()
            if (!trimmed) return undefined
            const n = Number(trimmed)
            return Number.isFinite(n) ? n : v
          }
          return v
        },
        z
          .number()
          .finite()
          .min(-90, { message: 'lat 必须在 -90 ~ 90' })
          .max(90, { message: 'lat 必须在 -90 ~ 90' })
          .optional()
      )
      .optional(),
    lng: z
      .preprocess(
        (v) => {
          if (typeof v === 'string') {
            const trimmed = v.trim()
            if (!trimmed) return undefined
            const n = Number(trimmed)
            return Number.isFinite(n) ? n : v
          }
          return v
        },
        z
          .number()
          .finite()
          .min(-180, { message: 'lng 必须在 -180 ~ 180' })
          .max(180, { message: 'lng 必须在 -180 ~ 180' })
          .optional()
      )
      .optional(),
    photoTip: z.string().optional(),
    note: z.string().optional(),
  })
  .passthrough()

const routeSchema: z.ZodType<SeichiRouteEmbedV1> = z
  .object({
    version: z.literal(1),
    title: z.string().optional(),
    spots: z.array(spotSchema).min(1, { message: 'spots 至少需要 1 个地点' }).max(200, { message: 'spots 过多' }),
  })
  .passthrough()

function normalizeOptionalString(input: unknown): string | undefined {
  if (typeof input !== 'string') return undefined
  const trimmed = input.trim()
  return trimmed ? trimmed : undefined
}

function normalizeOptionalNumber(input: unknown): number | undefined {
  if (typeof input !== 'number') return undefined
  if (!Number.isFinite(input)) return undefined
  return input
}

function normalizeSpot(input: SeichiRouteSpotV1): SeichiRouteSpotV1 {
  return {
    name: normalizeOptionalString(input.name),
    name_zh: normalizeOptionalString(input.name_zh),
    name_ja: normalizeOptionalString(input.name_ja),
    nearestStation_zh: normalizeOptionalString(input.nearestStation_zh),
    nearestStation_ja: normalizeOptionalString(input.nearestStation_ja),
    animeScene: normalizeOptionalString(input.animeScene),
    googleMapsUrl: normalizeOptionalString(input.googleMapsUrl),
    lat: normalizeOptionalNumber(input.lat),
    lng: normalizeOptionalNumber(input.lng),
    photoTip: normalizeOptionalString(input.photoTip),
    note: normalizeOptionalString(input.note),
  }
}

export function parseSeichiRouteEmbedV1(input: unknown): ParseSeichiRouteEmbedResult {
  const parsed = routeSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message || '路线 JSON 格式错误' }
  }

  const title = normalizeOptionalString(parsed.data.title)
  const spots = parsed.data.spots.map(normalizeSpot)
  return { ok: true, value: { version: 1, title, spots } }
}
