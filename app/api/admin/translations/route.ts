import { NextRequest, NextResponse } from 'next/server'
import { getServerAuthSession } from '@/lib/auth/session'
import { prisma } from '@/lib/db/prisma'
import {
  listTranslationTasksForAdmin,
  parseTranslationTaskListQuery,
} from '@/lib/translation/adminDashboard'

export async function GET(req: NextRequest) {
  try {
    const session = await getServerAuthSession()
    if (!session?.user?.isAdmin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const query = parseTranslationTaskListQuery({
      status: searchParams.get('status'),
      entityType: searchParams.get('entityType'),
      targetLanguage: searchParams.get('targetLanguage'),
      q: searchParams.get('q'),
      page: searchParams.get('page'),
      pageSize: searchParams.get('pageSize'),
    })

    const result = await listTranslationTasksForAdmin(query)
    return NextResponse.json(result)
  } catch (error) {
    console.error('[api/admin/translations] GET failed', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerAuthSession()
    if (!session?.user?.isAdmin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { entityType, entityId, targetLanguages } = body

    if (!entityType || !entityId || !Array.isArray(targetLanguages)) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    const tasks = await Promise.all(
      targetLanguages.map((targetLanguage) =>
        prisma.translationTask.upsert({
          where: {
            entityType_entityId_targetLanguage: {
              entityType,
              entityId,
              targetLanguage,
            },
          },
          create: {
            entityType,
            entityId,
            targetLanguage,
            status: 'pending',
          },
          update: {},
        })
      )
    )

    return NextResponse.json({ tasks })
  } catch (error) {
    console.error('[api/admin/translations] POST failed', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
