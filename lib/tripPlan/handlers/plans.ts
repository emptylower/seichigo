import { NextResponse } from 'next/server'
import type { Session } from 'next-auth'
import type { TripPlanRepo } from '@/lib/tripPlan/repo'
import { DEFAULT_PLAN_TITLE } from '@/lib/tripPlan/repo'
import { toPlanListItemView } from '@/lib/tripPlan/view'
import type { SupportedLocale } from '@/lib/i18n/types'
import { getLocale as nextGetLocale } from '@/lib/i18n/getLocale'
import { serverText } from '@/lib/planAgent/serverText'

export const DAILY_PLAN_CREATE_LIMIT = 3

export type TripPlanHandlerDeps = {
  repo: TripPlanRepo
  getSession: () => Promise<Session | null>
  /**
   * §0.6 错误文案语言：缺省读请求头（x-seichigo-locale / accept-language，
   * 即 lib/i18n/getLocale）；测试注入内存实现。读取失败（无请求上下文，
   * 如单元测试直调）回落中文——语言解析绝不阻塞错误响应本身。
   */
  getLocale?: () => Promise<SupportedLocale>
}

async function defaultHandlerLocale(): Promise<SupportedLocale> {
  try {
    return await nextGetLocale()
  } catch {
    return 'zh'
  }
}

/** handler/route 共用的语言解析入口：注入优先，缺省走 getLocale */
export async function handlerLocale(deps: TripPlanHandlerDeps): Promise<SupportedLocale> {
  return deps.getLocale ? deps.getLocale() : defaultHandlerLocale()
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
      if (!userId) {
        return NextResponse.json({ error: serverText(await handlerLocale(deps)).errors.notSignedIn }, { status: 401 })
      }
      const plans = await deps.repo.listPlans(userId)
      return NextResponse.json({ plans: plans.map(toPlanListItemView) })
    },

    async POST(req: Request) {
      const session = await deps.getSession()
      const userId = session?.user?.id
      if (!userId) {
        return NextResponse.json({ error: serverText(await handlerLocale(deps)).errors.notSignedIn }, { status: 401 })
      }

      const created = await deps.repo.countPlansCreatedSince(userId, startOfToday())
      if (created >= DAILY_PLAN_CREATE_LIMIT) {
        return NextResponse.json(
          { error: serverText(await handlerLocale(deps)).errors.createQuotaExhausted },
          { status: 429 },
        )
      }

      let title = DEFAULT_PLAN_TITLE
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
