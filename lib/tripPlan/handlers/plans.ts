import { NextResponse } from 'next/server'
import type { Session } from 'next-auth'
import type { TripPlanRepo } from '@/lib/tripPlan/repo'
import { toPlanListItemView } from '@/lib/tripPlan/view'

export const DAILY_PLAN_CREATE_LIMIT = 3

export type TripPlanHandlerDeps = {
  repo: TripPlanRepo
  getSession: () => Promise<Session | null>
}

export function startOfToday(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

export function createPlansHandlers(deps: TripPlanHandlerDeps) {
  return {
    async GET() {
      const session = await deps.getSession()
      const userId = session?.user?.id
      if (!userId) return NextResponse.json({ error: '未登录' }, { status: 401 })
      const plans = await deps.repo.listPlans(userId)
      return NextResponse.json({ plans: plans.map(toPlanListItemView) })
    },

    async POST(req: Request) {
      const session = await deps.getSession()
      const userId = session?.user?.id
      if (!userId) return NextResponse.json({ error: '未登录' }, { status: 401 })

      const created = await deps.repo.countPlansCreatedSince(userId, startOfToday())
      if (created >= DAILY_PLAN_CREATE_LIMIT) {
        return NextResponse.json({ error: '今日创建计划次数已达上限，明天再来吧' }, { status: 429 })
      }

      let title = '未命名巡礼计划'
      try {
        const body = (await req.json()) as { title?: unknown }
        if (typeof body.title === 'string' && body.title.trim()) title = body.title.trim().slice(0, 80)
      } catch {
        // 空 body 用默认标题
      }

      const plan = await deps.repo.createPlan({ userId, title })
      return NextResponse.json({ plan: toPlanListItemView(plan) }, { status: 201 })
    },
  }
}
