import { NextResponse } from 'next/server'
import { TRIP_PLAN_STATUSES, type TripPlanStatus, type TripPlanWithDays } from '@/lib/tripPlan/repo'
import { toChatView, toPlanView } from '@/lib/tripPlan/view'
import type { TripPlanHandlerDeps } from './plans'

type AuthorizeResult = { error: NextResponse } | { plan: TripPlanWithDays; userId: string }

export function createPlanByIdHandlers(deps: TripPlanHandlerDeps) {
  async function authorize(planId: string): Promise<AuthorizeResult> {
    const session = await deps.getSession()
    const userId = session?.user?.id
    if (!userId) return { error: NextResponse.json({ error: '未登录' }, { status: 401 }) }
    const plan = await deps.repo.getPlan(planId)
    if (!plan) return { error: NextResponse.json({ error: '计划不存在' }, { status: 404 }) }
    if (plan.userId !== userId) return { error: NextResponse.json({ error: '无权访问' }, { status: 403 }) }
    return { plan, userId }
  }

  return {
    async GET(planId: string) {
      const auth = await authorize(planId)
      if ('error' in auth) return auth.error
      const chat = toChatView(await deps.repo.listMessages(planId))
      return NextResponse.json({ plan: toPlanView(auth.plan), chat })
    },

    async PATCH(planId: string, req: Request) {
      const auth = await authorize(planId)
      if ('error' in auth) return auth.error

      let body: { title?: unknown; status?: unknown }
      try {
        body = (await req.json()) as { title?: unknown; status?: unknown }
      } catch {
        return NextResponse.json({ error: '请求体不是合法 JSON' }, { status: 400 })
      }

      const patch: { title?: string; status?: TripPlanStatus } = {}
      if (body.title !== undefined) {
        if (typeof body.title !== 'string' || !body.title.trim()) {
          return NextResponse.json({ error: '标题不能为空' }, { status: 400 })
        }
        patch.title = body.title.trim().slice(0, 80)
      }
      if (body.status !== undefined) {
        if (typeof body.status !== 'string' || !TRIP_PLAN_STATUSES.includes(body.status as TripPlanStatus)) {
          return NextResponse.json({ error: '非法状态' }, { status: 400 })
        }
        patch.status = body.status as TripPlanStatus
      }

      await deps.repo.updateMeta(planId, patch)
      const plan = await deps.repo.getPlan(planId)
      return NextResponse.json({ plan: plan ? toPlanView(plan) : null })
    },
  }
}
