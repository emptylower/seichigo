import { NextResponse } from 'next/server'
import type { TranslationApiDeps } from '@/lib/translation/api'
import { isAdminSession } from '@/lib/translation/handlers/common'

export function createHandlers(deps: TranslationApiDeps) {
  return {
    async GET(req: Request) {
      const session = await deps.getSession()
      if (!isAdminSession(session)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const { searchParams } = new URL(req.url)
      const query = deps.parseTranslationTaskListQuery({
        status: searchParams.get('status'),
        entityType: searchParams.get('entityType'),
        targetLanguage: searchParams.get('targetLanguage'),
        q: searchParams.get('q'),
        page: searchParams.get('page'),
        pageSize: searchParams.get('pageSize'),
      })

      const result = await deps.listTranslationTasksForAdmin(query)
      return NextResponse.json(result)
    },

    async POST(req: Request) {
      const session = await deps.getSession()
      if (!isAdminSession(session)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const body = await req.json()
      const { entityType, entityId, targetLanguages } = body as {
        entityType?: string
        entityId?: string
        targetLanguages?: string[]
      }

      if (!entityType || !entityId || !Array.isArray(targetLanguages)) {
        return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
      }

      const tasks = await Promise.all(
        targetLanguages.map((targetLanguage) =>
          deps.prisma.translationTask.upsert({
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
    },
  }
}
