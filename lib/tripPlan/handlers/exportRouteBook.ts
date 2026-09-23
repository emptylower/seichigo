import { NextResponse } from 'next/server'
import type { RouteBookExportStore } from '@/lib/routeBook/exportStore'
import { buildExportInput } from '@/lib/tripPlan/exportMapping'
import type { TripPlanHandlerDeps } from './plans'

export type ExportRouteBookHandlerDeps = TripPlanHandlerDeps & {
  routeBookStore: RouteBookExportStore
}

export function createExportRouteBookHandler(deps: ExportRouteBookHandlerDeps) {
  return {
    async POST(planId: string) {
      const session = await deps.getSession()
      const userId = session?.user?.id
      if (!userId) return NextResponse.json({ error: '未登录' }, { status: 401 })
      const plan = await deps.repo.getPlan(planId)
      if (!plan) return NextResponse.json({ error: '计划不存在' }, { status: 404 })
      if (plan.userId !== userId) return NextResponse.json({ error: '无权访问' }, { status: 403 })

      const existing = await deps.routeBookStore.findBySourcePlanId(userId, planId)
      if (existing) {
        return NextResponse.json({ ok: true, routeBookId: existing.id, created: false })
      }

      const { input, counts } = buildExportInput(plan)
      if (input.items.length === 0 && input.lodgings.length === 0) {
        return NextResponse.json({ error: '计划还没有可导出的条目' }, { status: 400 })
      }

      const created = await deps.routeBookStore.createFromPlan({
        ...input,
        userId,
      })
      return NextResponse.json(
        { ok: true, routeBookId: created.id, created: true, counts },
        { status: 201 }
      )
    },
  }
}
