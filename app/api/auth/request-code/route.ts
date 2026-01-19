import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db/prisma'
import { sendMail } from '@/lib/email/sender'
import { renderSigninOtpEmail, renderSignupOtpEmail } from '@/lib/email/templates/seichigoOtp'
import { generateEmailOtpCode, generateEmailOtpSalt, hashEmailOtpCode, normalizeEmail, resolveOtpSecret, sha256Hex } from '@/lib/auth/emailOtp'

export const runtime = 'nodejs'

const schema = z.object({
  email: z.string().email(),
})

function getClientIp(req: Request) {
  const xf = req.headers.get('x-forwarded-for') || ''
  const ip = xf.split(',')[0].trim() || req.headers.get('x-real-ip') || ''
  return ip
}

function resolveCooldownMs(): number {
  const raw = process.env.EMAIL_OTP_COOLDOWN_SECONDS
  const n = raw ? Number(raw) : 60
  if (!Number.isFinite(n) || n <= 0) return 60_000
  return Math.floor(n * 1000)
}

function resolveTtlMs(): number {
  const raw = process.env.EMAIL_OTP_TTL_MINUTES
  const n = raw ? Number(raw) : 10
  if (!Number.isFinite(n) || n <= 0) return 10 * 60_000
  return Math.floor(n * 60_000)
}

export async function POST(req: Request) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: '数据库未配置' }, { status: 503 })
  }

  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: '邮箱格式不正确' }, { status: 400 })
  }

  const email = normalizeEmail(parsed.data.email)
  if (!email) {
    return NextResponse.json({ error: '邮箱格式不正确' }, { status: 400 })
  }

  const now = new Date()
  const cooldownMs = resolveCooldownMs()
  const ttlMs = resolveTtlMs()

  const last = await prisma.emailOtp.findFirst({
    where: { email },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  })

  if (last?.createdAt) {
    const delta = now.getTime() - new Date(last.createdAt).getTime()
    if (delta < cooldownMs) {
      const retryAfterSeconds = Math.ceil((cooldownMs - delta) / 1000)
      return NextResponse.json(
        { error: `请稍候再试（${retryAfterSeconds}s）`, retryAfterSeconds },
        { status: 429, headers: { 'retry-after': String(retryAfterSeconds) } }
      )
    }
  }

  // Best-effort IP hash for abuse detection (not for auth)
  const ip = getClientIp(req) || '0.0.0.0'
  const ipHash = sha256Hex(ip + (process.env.RATE_LIMIT_SALT || ''))

  const existingUser = await prisma.user.findUnique({ where: { email }, select: { id: true } }).catch(() => null)

  const code = generateEmailOtpCode()
  const salt = generateEmailOtpSalt()
  const codeHash = hashEmailOtpCode({ code, salt, secret: resolveOtpSecret() })
  const expiresAt = new Date(now.getTime() + ttlMs)

  await prisma.emailOtp.create({
    data: {
      email,
      salt,
      codeHash,
      expiresAt,
      ipHash,
    },
  })

  const tpl = existingUser ? renderSigninOtpEmail(code) : renderSignupOtpEmail(code)
  const from = process.env.EMAIL_FROM || 'no-reply@example.com'

  try {
    await sendMail({
      to: email,
      from,
      subject: tpl.subject,
      text: tpl.text,
      html: tpl.html,
    })
  } catch (err: any) {
    console.error('OTP email send failed', { message: err?.message })
    return NextResponse.json({ error: '邮件发送失败，请稍后重试' }, { status: 502 })
  }

  return NextResponse.json({
    ok: true,
    cooldownSeconds: Math.floor(cooldownMs / 1000),
    expiresAt: expiresAt.toISOString(),
  })
}

