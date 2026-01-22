import { prisma } from '@/lib/db/prisma'

function uniqueStrings(list: string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of list) {
    const v = String(raw || '').trim()
    if (!v || seen.has(v)) continue
    seen.add(v)
    out.push(v)
  }
  return out
}

export async function getArticleCityIds(articleId: string): Promise<string[]> {
  const id = String(articleId || '').trim()
  if (!id) return []
  const rows = await prisma.articleCity.findMany({ where: { articleId: id }, select: { cityId: true } })
  return rows.map((r) => r.cityId)
}

export async function setArticleCityIds(articleId: string, cityIds: string[]): Promise<void> {
  const id = String(articleId || '').trim()
  if (!id) return
  const next = uniqueStrings(Array.isArray(cityIds) ? cityIds : [])
  await prisma.$transaction(async (tx) => {
    await tx.articleCity.deleteMany({ where: { articleId: id } })
    if (!next.length) return
    await tx.articleCity.createMany({
      data: next.map((cityId) => ({ articleId: id, cityId })),
      skipDuplicates: true,
    })
  })
}

export async function getRevisionCityIds(revisionId: string): Promise<string[]> {
  const id = String(revisionId || '').trim()
  if (!id) return []
  const rows = await prisma.articleRevisionCity.findMany({ where: { revisionId: id }, select: { cityId: true } })
  return rows.map((r) => r.cityId)
}

export async function setRevisionCityIds(revisionId: string, cityIds: string[]): Promise<void> {
  const id = String(revisionId || '').trim()
  if (!id) return
  const next = uniqueStrings(Array.isArray(cityIds) ? cityIds : [])
  await prisma.$transaction(async (tx) => {
    await tx.articleRevisionCity.deleteMany({ where: { revisionId: id } })
    if (!next.length) return
    await tx.articleRevisionCity.createMany({
      data: next.map((cityId) => ({ revisionId: id, cityId })),
      skipDuplicates: true,
    })
  })
}
