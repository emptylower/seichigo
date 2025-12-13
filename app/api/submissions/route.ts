import { NextResponse } from 'next/server'
import { getServerAuthSession } from '@/lib/auth/session'
import { prisma } from '@/lib/db/prisma'
import { z } from 'zod'
import crypto from 'node:crypto'

const schema = z.object({
  animeName: z.string().min(1),
  city: z.string().min(1),
  title: z.string().min(5),
  contentMarkdown: z.string().min(100),
  references: z.string().optional(),
})

function getClientIp(req: Request) {
  const xf = req.headers.get('x-forwarded-for') || ''
  const ip = xf.split(',')[0].trim() || req.headers.get('x-real-ip') || ''
  return ip
}

function sha256(input: string) {
  return crypto.createHash('sha256').update(input).digest('hex')
}

export async function POST(req: Request) {
  const session = await getServerAuthSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: '请先登录' }, { status: 401 })
  }

  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || '参数错误' }, { status: 400 })
  }

  const limitUser = Number(process.env.RATE_LIMIT_USER_PER_DAY || 3)
  const limitIp = Number(process.env.RATE_LIMIT_IP_PER_DAY || 5)
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000)

  // per-user limit
  const userCount = await prisma.submission.count({ where: { userId: session.user.id, createdAt: { gte: since } } })
  if ((userCount || 0) >= limitUser) {
    return NextResponse.json({ error: '今天提交次数已达上限，请明日再试' }, { status: 429 })
  }

  // per-ip limit (best-effort)
  const ip = getClientIp(req) || '0.0.0.0'
  const ipHash = sha256(ip + (process.env.RATE_LIMIT_SALT || ''))
  const ipCount = await prisma.submission.count({ where: { ipHash, createdAt: { gte: since } } })
  if ((ipCount || 0) >= limitIp) {
    return NextResponse.json({ error: '请求过于频繁，请稍后再试' }, { status: 429 })
  }

  await prisma.submission.create({
    data: {
      userId: session.user.id,
      title: parsed.data.title,
      animeName: parsed.data.animeName,
      city: parsed.data.city,
      contentMarkdown: parsed.data.contentMarkdown,
      references: parsed.data.references,
      status: 'pending',
      ipHash,
    },
  })

  return NextResponse.json({ ok: true })
}
