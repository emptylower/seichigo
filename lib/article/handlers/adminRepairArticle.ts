import { NextResponse } from 'next/server'
import type { ArticleRepairApiDeps } from '@/lib/article/adminRepairApi'

interface RepairItem {
  article: 'zh' | 'en'
  field: string
  from: string
  to: string
}

export function createHandlers(deps: ArticleRepairApiDeps) {
  return {
    async POST(req: Request) {
      const session = await deps.getSession()
      if (!session?.user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const { searchParams } = new URL(req.url)
      const slug = searchParams.get('slug')
      const dryRun = searchParams.get('dryRun') === 'true'

      if (!slug) {
        return NextResponse.json(
          { error: 'Missing required parameter: slug' },
          { status: 400 }
        )
      }

      const zhArticle = await deps.prisma.article.findUnique({
        where: { slug_language: { slug, language: 'zh' } },
        select: {
          id: true,
          translationGroupId: true,
          title: true,
          seoTitle: true,
          description: true,
          cover: true,
          contentJson: true,
          contentHtml: true,
          animeIds: true,
          city: true,
          routeLength: true,
          tags: true,
        },
      })

      if (!zhArticle) {
        return NextResponse.json(
          {
            error: 'Chinese article not found',
            details: `No article found with slug "${slug}" and language "zh"`,
          },
          { status: 404 }
        )
      }

      const enArticle = await deps.prisma.article.findUnique({
        where: { slug_language: { slug, language: 'en' } },
        select: {
          id: true,
          translationGroupId: true,
          title: true,
          seoTitle: true,
          description: true,
          cover: true,
          contentJson: true,
          contentHtml: true,
          animeIds: true,
          city: true,
          routeLength: true,
          tags: true,
        },
      })

      if (!enArticle) {
        return NextResponse.json(
          {
            error: 'English article not found',
            details: `No article found with slug "${slug}" and language "en"`,
          },
          { status: 404 }
        )
      }

      const repairs: RepairItem[] = []

      if (!zhArticle.translationGroupId) {
        repairs.push({
          article: 'zh',
          field: 'translationGroupId',
          from: 'null',
          to: zhArticle.id,
        })
      } else if (zhArticle.translationGroupId !== zhArticle.id) {
        repairs.push({
          article: 'zh',
          field: 'translationGroupId',
          from: zhArticle.translationGroupId,
          to: zhArticle.id,
        })
      }

      if (!enArticle.translationGroupId) {
        repairs.push({
          article: 'en',
          field: 'translationGroupId',
          from: 'null',
          to: zhArticle.id,
        })
      } else if (enArticle.translationGroupId !== zhArticle.id) {
        repairs.push({
          article: 'en',
          field: 'translationGroupId',
          from: enArticle.translationGroupId,
          to: zhArticle.id,
        })
      }

      if (!enArticle.cover && zhArticle.cover) {
        repairs.push({
          article: 'en',
          field: 'cover',
          from: 'null',
          to: zhArticle.cover,
        })
      }

      if (!enArticle.contentJson && zhArticle.contentJson) {
        repairs.push({
          article: 'en',
          field: 'contentJson',
          from: 'null',
          to: 'copied from zh',
        })
      }

      if (!enArticle.contentHtml && zhArticle.contentHtml) {
        repairs.push({
          article: 'en',
          field: 'contentHtml',
          from: 'empty',
          to: `${zhArticle.contentHtml.length} chars`,
        })
      }

      if (enArticle.animeIds.length === 0 && zhArticle.animeIds.length > 0) {
        repairs.push({
          article: 'en',
          field: 'animeIds',
          from: '[]',
          to: `[${zhArticle.animeIds.join(', ')}]`,
        })
      }

      if (!enArticle.city && zhArticle.city) {
        repairs.push({
          article: 'en',
          field: 'city',
          from: 'null',
          to: zhArticle.city,
        })
      }

      if (!enArticle.routeLength && zhArticle.routeLength) {
        repairs.push({
          article: 'en',
          field: 'routeLength',
          from: 'null',
          to: zhArticle.routeLength,
        })
      }

      if (enArticle.tags.length === 0 && zhArticle.tags.length > 0) {
        repairs.push({
          article: 'en',
          field: 'tags',
          from: '[]',
          to: `[${zhArticle.tags.join(', ')}]`,
        })
      }

      if (repairs.length === 0) {
        return NextResponse.json({
          success: true,
          dryRun,
          repairs: [],
          message: 'No repairs needed - all data is correct',
        })
      }

      if (dryRun) {
        return NextResponse.json({
          success: true,
          dryRun: true,
          repairs,
        })
      }

      const zhRepairs = repairs.filter((repair) => repair.article === 'zh')
      if (zhRepairs.length > 0) {
        const zhData: Record<string, unknown> = {}
        zhRepairs.forEach((repair) => {
          if (repair.field === 'translationGroupId') {
            zhData[repair.field] = repair.to
          }
        })

        await deps.prisma.article.update({
          where: { id: zhArticle.id },
          data: zhData,
        })
      }

      const enRepairs = repairs.filter((repair) => repair.article === 'en')
      if (enRepairs.length > 0) {
        const enData: Record<string, unknown> = {}
        enRepairs.forEach((repair) => {
          if (repair.field === 'translationGroupId') {
            enData[repair.field] = repair.to
          } else if (repair.field === 'cover') {
            enData[repair.field] = zhArticle.cover
          } else if (repair.field === 'contentJson') {
            enData[repair.field] = zhArticle.contentJson
          } else if (repair.field === 'contentHtml') {
            enData[repair.field] = zhArticle.contentHtml
          } else if (repair.field === 'animeIds') {
            enData[repair.field] = zhArticle.animeIds
          } else if (repair.field === 'city') {
            enData[repair.field] = zhArticle.city
          } else if (repair.field === 'routeLength') {
            enData[repair.field] = zhArticle.routeLength
          } else if (repair.field === 'tags') {
            enData[repair.field] = zhArticle.tags
          }
        })

        await deps.prisma.article.update({
          where: { id: enArticle.id },
          data: enData,
        })
      }

      return NextResponse.json({
        success: true,
        dryRun: false,
        repairs,
        message: 'Repairs applied successfully',
      })
    },
  }
}
