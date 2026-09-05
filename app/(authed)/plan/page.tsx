import { redirect } from 'next/navigation'
import { getTripPlanApiDeps } from '@/lib/tripPlan/api'
import { DEFAULT_PLAN_TITLE } from '@/lib/tripPlan/repo'

export const dynamic = 'force-dynamic'

/**
 * /plan 不再有独立的会话列表页：直接跳到最新更新的对话；一个对话都没有时
 * 先创建一个默认标题的计划再跳过去——任何已创建的对话都会立刻出现在侧栏。
 */
export default async function PlanIndexPage() {
  const deps = await getTripPlanApiDeps()
  const session = await deps.getSession()
  if (!session?.user?.id) redirect('/auth/signin?callbackUrl=/plan')

  const plans = await deps.repo.listPlans(session.user.id) // updatedAt 倒序
  const latest = plans[0]
  if (latest) redirect(`/plan/${latest.id}`)

  const created = await deps.repo.createPlan({ userId: session.user.id, title: DEFAULT_PLAN_TITLE })
  redirect(`/plan/${created.id}`)
}
