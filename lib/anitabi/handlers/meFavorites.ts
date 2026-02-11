import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { AnitabiApiDeps } from '@/lib/anitabi/api'
import { upsertFavorite } from '@/lib/anitabi/me'

const schema = z.object({
  targetType: z.enum(['bangumi', 'point']),
  bangumiId: z.number().int().positive().optional(),
  pointId: z.string().min(1).optional(),
  remove: z.boolean().optional(),
})

export function createHandlers(deps: AnitabiApiDeps) {
  return {
    async POST(req: Request) {
      const session = await deps.getSession()
      if (!session?.user?.id) {
        return NextResponse.json({ error: '请先登录' }, { status: 401 })
      }

      const body = await req.json().catch(() => null)
      const parsed = schema.safeParse(body)
      if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0]?.message || '参数错误' }, { status: 400 })
      }

      const { targetType, bangumiId, pointId, remove } = parsed.data
      if (targetType === 'bangumi' && !Number.isFinite(Number(bangumiId))) {
        return NextResponse.json({ error: 'bangumiId 必填' }, { status: 400 })
      }
      if (targetType === 'point' && !pointId) {
        return NextResponse.json({ error: 'pointId 必填' }, { status: 400 })
      }

      const result = await upsertFavorite({
        prisma: deps.prisma,
        userId: session.user.id,
        targetType,
        bangumiId: bangumiId ?? null,
        pointId: pointId ?? null,
        remove,
      })

      return NextResponse.json(result)
    },
  }
}
