import { NextRequest, NextResponse } from 'next/server'
import { getServerAuthSession } from '@/lib/auth/session'
import { prisma } from '@/lib/db/prisma'

export async function GET(req: NextRequest) {
  try {
    const session = await getServerAuthSession()
    if (!session?.user?.isAdmin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const status = searchParams.get('status')
    const entityType = searchParams.get('entityType')

    const where: any = {}
    if (status) where.status = status
    if (entityType) where.entityType = entityType

    const [tasks, total] = await Promise.all([
      prisma.translationTask.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      prisma.translationTask.count({ where }),
    ])

    return NextResponse.json({ tasks, total })
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
