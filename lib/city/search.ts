import { prisma } from '@/lib/db/prisma'
import { normalizeCityAlias } from './normalize'

export type CityListItem = {
  id: string
  slug: string
  name_zh: string
  name_en?: string | null
  name_ja?: string | null
}

export async function searchCities(q: string, limit: number = 12): Promise<CityListItem[]> {
  const raw = String(q || '').trim()
  const take = Math.max(1, Math.min(50, Number.isFinite(limit) ? limit : 12))
  if (!raw) {
    const list = await prisma.city.findMany({
      where: { hidden: false },
      orderBy: { updatedAt: 'desc' },
      take,
      select: { id: true, slug: true, name_zh: true, name_en: true, name_ja: true },
    })
    return list
  }

  const norm = normalizeCityAlias(raw)
  const list = await prisma.city.findMany({
    where: {
      OR: [
        { slug: { contains: raw.toLowerCase() } },
        { name_zh: { contains: raw } },
        { name_en: { contains: raw, mode: 'insensitive' } },
        { name_ja: { contains: raw } },
        { aliases: { some: { aliasNorm: { contains: norm } } } },
      ],
    },
    orderBy: { updatedAt: 'desc' },
    take,
    select: { id: true, slug: true, name_zh: true, name_en: true, name_ja: true },
  })
  return list
}
