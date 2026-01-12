import { prisma } from '@/lib/db/prisma'
import type { FavoriteRecord, FavoriteRepo, FavoriteTarget } from './repo'

export class PrismaFavoriteRepo implements FavoriteRepo {
  async add(userId: string, target: FavoriteTarget): Promise<void> {
    if (target.source === 'db') {
      await prisma.favorite.upsert({
        where: { userId_articleId: { userId, articleId: target.articleId } },
        update: {},
        create: { userId, articleId: target.articleId },
      })
      return
    }

    await (prisma as any).mdxFavorite.upsert({
      where: { userId_slug: { userId, slug: target.slug } },
      update: {},
      create: { userId, slug: target.slug },
    })
  }

  async remove(userId: string, target: FavoriteTarget): Promise<void> {
    if (target.source === 'db') {
      await prisma.favorite.deleteMany({ where: { userId, articleId: target.articleId } })
      return
    }
    await (prisma as any).mdxFavorite.deleteMany({ where: { userId, slug: target.slug } })
  }

  async isFavorited(userId: string, target: FavoriteTarget): Promise<boolean> {
    if (target.source === 'db') {
      const found = await prisma.favorite.findUnique({
        where: { userId_articleId: { userId, articleId: target.articleId } },
        select: { userId: true },
      })
      return Boolean(found)
    }

    const found = await (prisma as any).mdxFavorite.findUnique({
      where: { userId_slug: { userId, slug: target.slug } },
      select: { userId: true },
    })
    return Boolean(found)
  }

  async listByUser(userId: string): Promise<FavoriteRecord[]> {
    const [db, mdx] = await Promise.all([
      prisma.favorite.findMany({
        where: { userId },
        select: { articleId: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      }),
      (prisma as any).mdxFavorite.findMany({
        where: { userId },
        select: { slug: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      }),
    ])

    const out: FavoriteRecord[] = []
    for (const f of db as any[]) out.push({ source: 'db', articleId: f.articleId, createdAt: f.createdAt })
    for (const f of mdx as any[]) out.push({ source: 'mdx', slug: f.slug, createdAt: f.createdAt })

    return out.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
  }
}

