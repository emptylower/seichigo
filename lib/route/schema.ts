import { z } from 'zod'

export type SeichiRouteSpotV1 = {
  name?: string
  name_zh?: string
  name_ja?: string
  nearestStation_zh?: string
  nearestStation_ja?: string
  animeScene?: string
  googleMapsUrl?: string
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

function normalizeSpot(input: SeichiRouteSpotV1): SeichiRouteSpotV1 {
  return {
    name: normalizeOptionalString(input.name),
    name_zh: normalizeOptionalString(input.name_zh),
    name_ja: normalizeOptionalString(input.name_ja),
    nearestStation_zh: normalizeOptionalString(input.nearestStation_zh),
    nearestStation_ja: normalizeOptionalString(input.nearestStation_ja),
    animeScene: normalizeOptionalString(input.animeScene),
    googleMapsUrl: normalizeOptionalString(input.googleMapsUrl),
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

