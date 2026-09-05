import { NextResponse } from 'next/server'
import type { RouteBookStatus } from '@/lib/routeBook/repo'
import type { RouteBookExportPointInput, RouteBookExportStore } from '@/lib/routeBook/exportStore'
import type { TripPlanHandlerDeps } from './plans'

export type ExportRouteBookHandlerDeps = TripPlanHandlerDeps & {
  routeBookStore: RouteBookExportStore
}

const EXPORTED_ROUTE_BOOK_STATUS: RouteBookStatus = 'draft'

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

      const points: RouteBookExportPointInput[] = []
      for (const day of [...plan.days].sort((a, b) => a.dayIndex - b.dayIndex)) {
        for (const item of [...day.items].sort((a, b) => a.sortOrder - b.sortOrder)) {
          if (item.type !== 'point') continue
          if (!item.pointId) continue
          points.push({ pointId: item.pointId, zone: `Day ${day.dayIndex}`, sortOrder: points.length })
        }
      }
      if (!points.length) {
        return NextResponse.json({ error: '计划还没有可导出的点位' }, { status: 400 })
      }

      const created = await deps.routeBookStore.createWithPoints({
        userId,
        title: plan.title,
        status: EXPORTED_ROUTE_BOOK_STATUS,
        metadata: {
          sourcePlanId: planId,
          startDate: plan.startDate ? plan.startDate.toISOString() : null,
        },
        points,
      })
      return NextResponse.json({ ok: true, routeBookId: created.id, created: true }, { status: 201 })
    },
  }
}
