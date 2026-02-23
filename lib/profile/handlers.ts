import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { ProfileRepo } from './repo'
import type { Session } from 'next-auth'

type ProfileApiDeps = {
  repo: ProfileRepo
  getSession: () => Promise<Session | null>
}

const patchSchema = z.object({
  name: z.string().nullable().optional(),
  image: z.string().nullable().optional(),
  bio: z.string().max(500).nullable().optional(),
  bilibili: z.string().nullable().optional(),
  weibo: z.string().nullable().optional(),
  github: z.string().nullable().optional(),
  twitter: z.string().nullable().optional(),
})

export function createHandlers(deps: ProfileApiDeps) {
  return {
    async GET(_req: Request) {
      const session = await deps.getSession()
      if (!session?.user?.id) {
        return NextResponse.json({ error: '请先登录' }, { status: 401 })
      }

      const profile = await deps.repo.getProfile(session.user.id)
      if (!profile) {
        return NextResponse.json({ error: '用户不存在' }, { status: 404 })
      }

      return NextResponse.json(profile)
    },

    async PATCH(req: Request) {
      const session = await deps.getSession()
      if (!session?.user?.id) {
        return NextResponse.json({ error: '请先登录' }, { status: 401 })
      }

      const body = await req.json()
      const parsed = patchSchema.safeParse(body)
      if (!parsed.success) {
        return NextResponse.json({ error: '参数验证失败', details: parsed.error }, { status: 400 })
      }

      const updated = await deps.repo.updateProfile(session.user.id, parsed.data)
      return NextResponse.json(updated)
    },
  }
}
