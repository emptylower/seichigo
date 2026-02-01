import { NextRequest, NextResponse } from 'next/server'
import { getServerAuthSession } from '@/lib/auth/session'
import { prisma } from '@/lib/db/prisma'

interface RepairItem {
  article: 'zh' | 'en'
  field: string
  from: string
  to: string
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerAuthSession()
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

    const zhArticle = await prisma.article.findUnique({
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
        tags: true
      }
    })

    if (!zhArticle) {
      return NextResponse.json(
        { error: 'Chinese article not found', details: `No article found with slug "${slug}" and language "zh"` },
        { status: 404 }
      )
    }

    const enArticle = await prisma.article.findUnique({
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
        tags: true
      }
    })

    if (!enArticle) {
      return NextResponse.json(
        { error: 'English article not found', details: `No article found with slug "${slug}" and language "en"` },
        { status: 404 }
      )
    }

    const repairs: RepairItem[] = []

    if (!zhArticle.translationGroupId) {
      repairs.push({
        article: 'zh',
        field: 'translationGroupId',
        from: 'null',
        to: zhArticle.id
      })
    } else if (zhArticle.translationGroupId !== zhArticle.id) {
      repairs.push({
        article: 'zh',
        field: 'translationGroupId',
        from: zhArticle.translationGroupId,
        to: zhArticle.id
      })
    }

    if (!enArticle.translationGroupId) {
      repairs.push({
        article: 'en',
        field: 'translationGroupId',
        from: 'null',
        to: zhArticle.id
      })
    } else if (enArticle.translationGroupId !== zhArticle.id) {
      repairs.push({
        article: 'en',
        field: 'translationGroupId',
        from: enArticle.translationGroupId,
        to: zhArticle.id
      })
    }

    if (!enArticle.cover && zhArticle.cover) {
      repairs.push({
        article: 'en',
        field: 'cover',
        from: 'null',
        to: zhArticle.cover
      })
    }

    if (!enArticle.contentJson && zhArticle.contentJson) {
      repairs.push({
        article: 'en',
        field: 'contentJson',
        from: 'null',
        to: 'copied from zh'
      })
    }

    if (!enArticle.contentHtml && zhArticle.contentHtml) {
      repairs.push({
        article: 'en',
        field: 'contentHtml',
        from: 'empty',
        to: `${zhArticle.contentHtml.length} chars`
      })
    }

    if (enArticle.animeIds.length === 0 && zhArticle.animeIds.length > 0) {
      repairs.push({
        article: 'en',
        field: 'animeIds',
        from: '[]',
        to: `[${zhArticle.animeIds.join(', ')}]`
      })
    }

    if (!enArticle.city && zhArticle.city) {
      repairs.push({
        article: 'en',
        field: 'city',
        from: 'null',
        to: zhArticle.city
      })
    }

    if (!enArticle.routeLength && zhArticle.routeLength) {
      repairs.push({
        article: 'en',
        field: 'routeLength',
        from: 'null',
        to: zhArticle.routeLength
      })
    }

    if (enArticle.tags.length === 0 && zhArticle.tags.length > 0) {
      repairs.push({
        article: 'en',
        field: 'tags',
        from: '[]',
        to: `[${zhArticle.tags.join(', ')}]`
      })
    }

    if (repairs.length === 0) {
      return NextResponse.json({
        success: true,
        dryRun,
        repairs: [],
        message: 'No repairs needed - all data is correct'
      })
    }

    if (dryRun) {
      return NextResponse.json({
        success: true,
        dryRun: true,
        repairs
      })
    }

    const zhRepairs = repairs.filter(r => r.article === 'zh')
    if (zhRepairs.length > 0) {
      const zhData: Record<string, any> = {}
      zhRepairs.forEach(r => {
        if (r.field === 'translationGroupId') {
          zhData[r.field] = r.to
        }
      })

      await prisma.article.update({
        where: { id: zhArticle.id },
        data: zhData
      })
    }

    const enRepairs = repairs.filter(r => r.article === 'en')
    if (enRepairs.length > 0) {
      const enData: Record<string, any> = {}
      enRepairs.forEach(r => {
        if (r.field === 'translationGroupId') {
          enData[r.field] = r.to
        } else if (r.field === 'cover') {
          enData[r.field] = zhArticle.cover
        } else if (r.field === 'contentJson') {
          enData[r.field] = zhArticle.contentJson
        } else if (r.field === 'contentHtml') {
          enData[r.field] = zhArticle.contentHtml
        } else if (r.field === 'animeIds') {
          enData[r.field] = zhArticle.animeIds
        } else if (r.field === 'city') {
          enData[r.field] = zhArticle.city
        } else if (r.field === 'routeLength') {
          enData[r.field] = zhArticle.routeLength
        } else if (r.field === 'tags') {
          enData[r.field] = zhArticle.tags
        }
      })

      await prisma.article.update({
        where: { id: enArticle.id },
        data: enData
      })
    }

    return NextResponse.json({
      success: true,
      dryRun: false,
      repairs,
      message: 'Repairs applied successfully'
    })
  } catch (error) {
    console.error('[api/admin/repair-article] POST failed', error)
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
