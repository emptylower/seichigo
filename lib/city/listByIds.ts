import { prisma } from '@/lib/db/prisma'
import type { CityLite } from './db'

export async function listCitiesByIds(ids: string[]): Promise<CityLite[]> {
  const input = Array.isArray(ids) ? ids.map((x) => String(x || '').trim()).filter(Boolean) : []
  if (!input.length) return []

  const list = await prisma.city.findMany({
    where: { id: { in: input } },
    select: {
      id: true,
      slug: true,
      name_zh: true,
      name_en: true,
      name_ja: true,
      description_zh: true,
      description_en: true,
      transportTips_zh: true,
      transportTips_en: true,
      cover: true,
      needsReview: true,
      hidden: true,
    },
  })

  const byId = new Map(list.map((c) => [c.id, c]))
  return input.map((id) => byId.get(id)).filter(Boolean) as CityLite[]
}
