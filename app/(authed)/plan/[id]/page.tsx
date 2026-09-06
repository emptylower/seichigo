import { notFound, redirect } from 'next/navigation'
import { getTripPlanApiDeps } from '@/lib/tripPlan/api'
import { getLocale } from '@/lib/i18n/getLocale'
import { toChatView, toPlanView } from '@/lib/tripPlan/view'
import { PlanPlanner } from './ui'

export const dynamic = 'force-dynamic'

export default async function PlanDetailPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  const deps = await getTripPlanApiDeps()
  const session = await deps.getSession()
  if (!session?.user?.id) redirect(`/auth/signin?callbackUrl=/plan/${id}`)

  const plan = await deps.repo.getPlan(id)
  if (!plan) notFound()
  if (plan.userId !== session.user.id) notFound()

  const chat = toChatView(await deps.repo.listMessages(id))
  const plans = (await deps.repo.listPlans(session.user.id)).map((p) => ({
    id: p.id,
    title: p.title,
    updatedAt: p.updatedAt.toISOString(),
  }))
  const locale = await getLocale()
  return (
    <PlanPlanner
      planId={id}
      initialPlan={toPlanView(plan)}
      initialChat={chat}
      plans={plans}
      locale={locale}
    />
  )
}
