import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { ShareApiDeps } from '@/lib/share/api'
import { hashIp, readClientIp } from '@/lib/share/ipHash'
import { allocateShareCode } from '@/lib/share/shortCode'
import type { CreateShareLinkResponse } from '@/lib/share/types'

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * 匿名每 24 小时最多 100 条短链（按 ipHash 数 ShareLink 表；wrangler 里没有 KV
 * 绑定，计数方式同 lib/tripPlan/repoPrisma.ts:261 的按日配额）。登录用户不受
 * 这条限制，改由上传配额兜底 —— 否则同一 NAT 出口下的用户会互相挤兑。
 */
export const ANON_DAILY_LINK_LIMIT = 100

const bodySchema = z.object({
  // pointId 会进 R2 key 与 URL，字符集收口在字母数字与 _ : . - 之内，并显式拒绝 .. 穿越
  pointId: z
    .string()
    .min(1)
    .max(200)
    .regex(/^[A-Za-z0-9_:.-]+$/)
    .refine((value) => !value.includes('..')),
  bangumiId: z.number().int().positive(),
  locale: z.enum(['zh', 'en', 'ja']),
  layout: z.enum(['portrait', 'landscape']),
})

function toResponse(code: string, origin: string): CreateShareLinkResponse {
  return { code, url: `${origin}/s/${code}` }
}

export function createPostShareLinkHandler(deps: ShareApiDeps) {
  return async function postShareLink(req: Request): Promise<Response> {
    const body = await req.json().catch(() => null)
    const parsed = bodySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || '参数错误' },
        { status: 400 },
      )
    }

    const now = deps.now()
    const since = new Date(now.getTime() - DAY_MS)
    const session = await deps.getSession()
    const userId = String(session?.user?.id || '').trim() || null
    const ipHash = userId ? null : await hashIp(readClientIp(req), now)

    const existing = await deps.repo.findRecentDuplicate({
      pointId: parsed.data.pointId,
      locale: parsed.data.locale,
      layout: parsed.data.layout,
      userId,
      ipHash,
      since,
    })
    if (existing) {
      return NextResponse.json(toResponse(existing.code, deps.origin), { status: 200 })
    }

    if (!userId && ipHash) {
      const used = await deps.repo.countByIpHashSince(ipHash, since)
      if (used >= ANON_DAILY_LINK_LIMIT) {
        return NextResponse.json({ error: '今日分享次数已达上限，请明天再试' }, { status: 429 })
      }
    }

    const created = await allocateShareCode((code) =>
      deps.repo.create({
        code,
        pointId: parsed.data.pointId,
        bangumiId: parsed.data.bangumiId,
        locale: parsed.data.locale,
        layout: parsed.data.layout,
        userId,
        ipHash,
      }),
    )

    return NextResponse.json(toResponse(created.code, deps.origin), { status: 201 })
  }
}
