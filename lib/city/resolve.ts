import { prisma } from '@/lib/db/prisma'
import type { City } from '@prisma/client'
import { normalizeCityAlias, randomSlugSuffix, slugifyAscii } from './normalize'

async function ensureUniqueSlug(preferred: string): Promise<string> {
  const base = preferred.trim()
  if (!base) return `city-${randomSlugSuffix()}`

  let candidate = base
  for (let i = 0; i < 50; i++) {
    const exists = await prisma.city.findUnique({ where: { slug: candidate }, select: { id: true } })
    if (!exists) return candidate
    candidate = `${base}-${i + 2}`
  }
  return `${base}-${randomSlugSuffix()}`
}

export type ResolveCitiesOptions = {
  createIfMissing?: boolean
}

export async function resolveCitiesByNames(
  names: string[],
  options?: ResolveCitiesOptions
): Promise<{ cities: City[]; createdCityIds: string[] }> {
  const createIfMissing = options?.createIfMissing !== false
  const createdCityIds: string[] = []

  const ordered: City[] = []
  const seen = new Set<string>()

  for (const rawInput of Array.isArray(names) ? names : []) {
    const alias = String(rawInput || '').trim()
    if (!alias) continue

    const aliasNorm = normalizeCityAlias(alias)
    if (!aliasNorm) continue

    const existingAlias = await prisma.cityAlias.findUnique({
      where: { aliasNorm },
      include: { city: true },
    })
    if (existingAlias?.city) {
      if (!seen.has(existingAlias.city.id)) {
        ordered.push(existingAlias.city)
        seen.add(existingAlias.city.id)
      }
      continue
    }

    if (!createIfMissing) continue

    const preferredSlug = slugifyAscii(alias)
    const slug = await ensureUniqueSlug(preferredSlug || `city-${randomSlugSuffix()}`)

    const created = await prisma.city.create({
      data: {
        slug,
        name_zh: alias,
        needsReview: true,
        hidden: false,
        aliases: {
          create: {
            alias,
            aliasNorm,
            isPrimary: true,
          },
        },
      },
    })

    createdCityIds.push(created.id)
    if (!seen.has(created.id)) {
      ordered.push(created)
      seen.add(created.id)
    }
  }

  return { cities: ordered, createdCityIds }
}
