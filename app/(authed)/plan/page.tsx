import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getTripPlanApiDeps } from '@/lib/tripPlan/api'
import { toPlanListItemView } from '@/lib/tripPlan/view'
import { CreatePlanButton } from './CreatePlanButton'

export const dynamic = 'force-dynamic'

export default async function PlanListPage() {
  const deps = await getTripPlanApiDeps()
  const session = await deps.getSession()
  if (!session?.user?.id) redirect('/auth/signin?callbackUrl=/plan')

  const plans = (await deps.repo.listPlans(session.user.id)).map(toPlanListItemView)

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-10 sm:px-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">我的巡礼计划</h1>
        <CreatePlanButton />
      </div>
      {plans.length ? (
        <ul className="space-y-3">
          {plans.map((plan) => (
            <li key={plan.id}>
              <Link
                href={`/plan/${plan.id}`}
                className="block rounded-2xl border border-gray-200 bg-white p-5 transition hover:border-brand-300 hover:shadow-sm"
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-gray-900">{plan.title}</span>
                  <span className="text-xs text-gray-400">{plan.dayCount} 天</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="rounded-2xl border border-dashed border-gray-300 p-10 text-center text-sm text-gray-500">
          还没有计划。点击“新建计划”，告诉 AI 规划师你想去哪巡礼。
        </div>
      )}
    </div>
  )
}
