import { prisma } from '@/lib/db/prisma'

export type CityPostItem = {
  title: string
  path: string
  animeIds: string[]
  city: string
  routeLength?: string
  publishDate?: string
  cover: string | null
}

export async function listPublishedDbPostsByCityId(
  cityId: string,
  language?: 'zh' | 'en' | 'ja'
): Promise<CityPostItem[]> {
  const id = String(cityId || '').trim()
  if (!id) return []

  const rows = await prisma.articleCity.findMany({
    where: {
      cityId: id,
      article: {
        status: 'published',
        ...(language && { language }),
      },
    },
    orderBy: [{ article: { publishedAt: 'desc' } }, { article: { updatedAt: 'desc' } }],
    select: {
      article: {
        select: {
          slug: true,
          title: true,
          language: true,
          animeIds: true,
          city: true,
          routeLength: true,
          publishedAt: true,
          cover: true,
          updatedAt: true,
        },
      },
    },
  })

  return rows
    .map((r) => {
      const a = r.article
      const publishedAtIso = a.publishedAt instanceof Date ? a.publishedAt.toISOString() : null
      const articleLanguage = String(a.language || 'zh')
      const localePrefix = articleLanguage === 'zh' ? '' : `/${articleLanguage}`
      const slug = String(a.slug || '')
      const path = `${localePrefix}/posts/${slug}`.replace(/\/posts\/$/, '/posts')
      return {
        title: String(a.title || ''),
        path,
        animeIds: Array.isArray(a.animeIds) ? a.animeIds : [],
        city: String(a.city || ''),
        routeLength: a.routeLength ?? undefined,
        publishDate: publishedAtIso ? publishedAtIso.slice(0, 10) : undefined,
        cover: a.cover ?? null,
      }
    })
    .filter((p) => p.title && p.path)
}
