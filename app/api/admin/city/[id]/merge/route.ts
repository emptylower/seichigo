import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getServerAuthSession } from '@/lib/auth/session'
import { prisma } from '@/lib/db/prisma'

export const runtime = 'nodejs'

const schema = z.object({
  targetCityId: z.string().min(1),
})

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerAuthSession()
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: '无权限' }, { status: 403 })
  }

  const { id: fromCityId } = await params
  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: '参数错误' }, { status: 400 })
  }

  const toCityId = parsed.data.targetCityId.trim()
  if (toCityId === fromCityId) {
    return NextResponse.json({ error: '不能合并到自身' }, { status: 400 })
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const from = await tx.city.findUnique({ where: { id: fromCityId } })
      const to = await tx.city.findUnique({ where: { id: toCityId } })
      if (!from || !to) throw new Error('未找到城市')

      const articleLinks = await tx.articleCity.findMany({ where: { cityId: fromCityId }, select: { articleId: true } })
      await tx.articleCity.createMany({
        data: articleLinks.map((r) => ({ articleId: r.articleId, cityId: toCityId })),
        skipDuplicates: true,
      })
      await tx.articleCity.deleteMany({ where: { cityId: fromCityId } })

      const revisionLinks = await tx.articleRevisionCity.findMany({ where: { cityId: fromCityId }, select: { revisionId: true } })
      await tx.articleRevisionCity.createMany({
        data: revisionLinks.map((r) => ({ revisionId: r.revisionId, cityId: toCityId })),
        skipDuplicates: true,
      })
      await tx.articleRevisionCity.deleteMany({ where: { cityId: fromCityId } })

      const submissionLinks = await tx.submissionCity.findMany({ where: { cityId: fromCityId }, select: { submissionId: true } })
      await tx.submissionCity.createMany({
        data: submissionLinks.map((r) => ({ submissionId: r.submissionId, cityId: toCityId })),
        skipDuplicates: true,
      })
      await tx.submissionCity.deleteMany({ where: { cityId: fromCityId } })

      const aliases = await tx.cityAlias.findMany({ where: { cityId: fromCityId } })
      if (aliases.length) {
        await tx.cityAlias.createMany({
          data: aliases.map((a) => ({
            cityId: toCityId,
            alias: a.alias,
            aliasNorm: a.aliasNorm,
            langCode: a.langCode,
            isPrimary: false,
          })),
          skipDuplicates: true,
        })
        await tx.cityAlias.deleteMany({ where: { cityId: fromCityId } })
      }

      await tx.cityRedirect.upsert({
        where: { fromSlug: from.slug },
        create: { fromSlug: from.slug, toCityId },
        update: { toCityId },
      })

      const hiddenFrom = await tx.city.update({ where: { id: fromCityId }, data: { hidden: true, needsReview: false } })
      return { from: hiddenFrom, to }
    })

    return NextResponse.json({ ok: true, from: { id: result.from.id, slug: result.from.slug }, to: { id: result.to.id, slug: result.to.slug } })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || '合并失败' }, { status: 400 })
  }
}
