import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { getServerAuthSession } from '@/lib/auth/session'
import { AdminSkeleton } from '@/components/admin/state/AdminSkeleton'
import TranslationsUI from './ui'
import {
  getTranslationTaskStatsForAdmin,
  listTranslationTasksForAdmin,
  parseTranslationTaskListQuery,
  parseTranslationTaskStatsFilter,
} from '@/lib/translation/adminDashboard'

export const metadata = {
  title: '翻译管理 - 管理后台',
}

type SearchParamsInput = Record<string, string | string[] | undefined>

function readSearchParam(searchParams: SearchParamsInput, key: string): string | null {
  const raw = searchParams[key]
  if (Array.isArray(raw)) {
    return raw[0] ?? null
  }
  return raw ?? null
}

export default async function TranslationsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParamsInput>
}) {
  const session = await getServerAuthSession()
  if (!session?.user) redirect('/auth/signin')
  if (!session.user.isAdmin) {
    return <div className="text-gray-600">无权限访问。</div>
  }

  const resolvedSearchParams = await searchParams
  const query = parseTranslationTaskListQuery({
    status: readSearchParam(resolvedSearchParams, 'status'),
    entityType: readSearchParam(resolvedSearchParams, 'entityType'),
    targetLanguage: readSearchParam(resolvedSearchParams, 'targetLanguage'),
    q: readSearchParam(resolvedSearchParams, 'q'),
    page: readSearchParam(resolvedSearchParams, 'page'),
    pageSize: readSearchParam(resolvedSearchParams, 'pageSize'),
  })

  const statsFilter = parseTranslationTaskStatsFilter({
    entityType: query.entityType,
    targetLanguage: query.targetLanguage,
  })

  const [initialList, initialStats] = await Promise.all([
    listTranslationTasksForAdmin(query),
    getTranslationTaskStatsForAdmin(statsFilter),
  ])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">翻译管理</h1>
        <p className="mt-1 text-sm text-gray-600">
          搜索、审核与维护翻译任务
        </p>
      </div>
      <Suspense fallback={<AdminSkeleton rows={8} />}>
        <TranslationsUI
          initialQuery={{
            status: query.status,
            entityType: query.entityType,
            targetLanguage: query.targetLanguage,
            q: query.q || '',
            page: query.page,
            pageSize: query.pageSize,
          }}
          initialTasks={initialList.tasks}
          initialTotal={initialList.total}
          initialStats={initialStats}
        />
      </Suspense>
    </div>
  )
}
