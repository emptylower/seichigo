export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { getServerAuthSession } from '@/lib/auth/session'
import { getCreemDeps, getCreemRepos } from '@/lib/billing/creem/serverDeps'
import { isCheckoutEnabled, normalizeIntentSource } from '@/lib/billing/checkoutGate'
import { getLocale as nextGetLocale } from '@/lib/i18n/getLocale'
import { getSiteOrigin } from '@/lib/seo/site'
import type { SupportedLocale } from '@/lib/i18n/types'

/** F11：同一用户并发/连击结账的去重窗口 */
const CHECKOUT_DEDUP_MS = 60_000

/** 与 agent 路由同样取法（§0.6）：请求头语言，无请求上下文回落中文，不阻塞响应 */
async function requestLocale(): Promise<SupportedLocale> {
  try {
    return await nextGetLocale()
  } catch {
    return 'zh'
  }
}

/** F3：意向记录失败只 warn，绝不影响结账/403 主流程（漏斗数据可丢，主路径不可断） */
async function recordIntent(input: {
  userId: string | null
  tier: string
  source: string
  locale: string | null
  gated: boolean
}): Promise<void> {
  try {
    await getCreemRepos().intents.record(input)
  } catch (err) {
    console.warn('[api/me/billing/checkout] intent record failed', err)
  }
}

/**
 * 创建 Creem 结账（设计 §5）：request_id = "<userId>:<uuid>"，metadata 携带 userId 与 tier。
 * F5：success_url 用站点权威地址（SITE_URL），不信任请求 origin；
 * F11：结账前以 checkout.requested 事件做 60 秒去重；nit：409 只对 active/trialing 生效。
 * F3（2026-09-07）：订阅开关——关闭期一律 403 checkout_disabled 并记 gated 意向（含未登录）；
 * 开启期先记 gated:false 意向再走原结账逻辑。
 */
export async function POST(req: Request) {
  try {
    let body: { source?: unknown } = {}
    try {
      body = (await req.json()) as { source?: unknown }
    } catch {
      // 可选 body：非法 JSON 视为空
    }
    const source = normalizeIntentSource(body.source)

    const session = await getServerAuthSession()
    const userId = session?.user?.id ?? null

    if (!isCheckoutEnabled()) {
      await recordIntent({ userId, tier: 'standard', source, locale: await requestLocale(), gated: true })
      return NextResponse.json({ code: 'checkout_disabled' }, { status: 403 })
    }

    if (!userId) return NextResponse.json({ error: 'not signed in' }, { status: 401 })

    await recordIntent({ userId, tier: 'standard', source, locale: await requestLocale(), gated: false })

    const deps = getCreemDeps()
    if (!deps) return NextResponse.json({ error: 'billing not configured' }, { status: 503 })

    const active = await deps.subs.findActiveByUser(userId)
    if (active && (active.status === 'active' || active.status === 'trialing')) {
      return NextResponse.json({ code: 'already_subscribed' }, { status: 409 })
    }

    const email = session?.user?.email
    if (!email) return NextResponse.json({ error: 'account email missing' }, { status: 400 })

    const recent = await deps.events.findRecentByType('checkout.requested', userId, CHECKOUT_DEDUP_MS)
    if (recent) return NextResponse.json({ code: 'checkout_in_progress' }, { status: 429 })

    const uuid = crypto.randomUUID()
    const dedupEventId = `checkout_request:${uuid}`
    await deps.events.claim({ id: dedupEventId, type: 'checkout.requested', payload: { userId } })
    await deps.events.markProcessed(dedupEventId)

    const checkout = await deps.client.createCheckout({
      productId: deps.config.productStandardId,
      requestId: `${userId}:${uuid}`,
      successUrl: `${getSiteOrigin()}/me?billing=success`,
      customerEmail: email,
      metadata: { userId, tier: 'standard' },
    })
    return NextResponse.json({ checkoutUrl: checkout.checkoutUrl })
  } catch (err) {
    console.error('[api/me/billing/checkout] POST failed', err)
    return NextResponse.json({ error: 'server error' }, { status: 500 })
  }
}
