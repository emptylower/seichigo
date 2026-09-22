import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db/prisma'
import { sendMail } from '@/lib/email/sender'
import { DEFAULT_EMAIL_FROM } from '@/lib/email/addresses'
import { renderSigninOtpEmail, renderSignupOtpEmail } from '@/lib/email/templates/seichigoOtp'
import { generateEmailOtpCode, generateEmailOtpSalt, hashEmailOtpCode, normalizeEmail, resolveOtpSecret, sha256Hex } from '@/lib/auth/emailOtp'
import { resolveRequestLocale } from '@/lib/i18n/resolveRequestLocale'

export const runtime = 'nodejs'

const schema = z.object({
  email: z.string().email(),
  locale: z.enum(['zh', 'en', 'ja']).optional().catch(undefined),
})

const messages = {
  zh: {
    databaseUnavailable: '数据库未配置',
    invalidEmail: '邮箱格式不正确',
    cooldown: '请稍候再试（{seconds}s）',
    sendFailed: '邮件发送失败，请稍后重试',
  },
  en: {
    databaseUnavailable: 'Database is not configured.',
    invalidEmail: 'Invalid email address.',
    cooldown: 'Please try again in {seconds}s.',
    sendFailed: 'Failed to send email. Please try again later.',
  },
  ja: {
    databaseUnavailable: 'データベースが設定されていません。',
    invalidEmail: 'メールアドレスの形式が正しくありません。',
    cooldown: '{seconds}秒後にもう一度お試しください。',
    sendFailed: 'メールの送信に失敗しました。しばらくしてからお試しください。',
  },
}

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
  const body = await req.json().catch(() => null)
  const requestedLocale = schema.shape.locale.safeParse(body?.locale)
  const locale = (requestedLocale.success && requestedLocale.data) || resolveRequestLocale({
    pathname: '/',
    cookieHeader: req.headers.get('cookie'),
    acceptLanguage: req.headers.get('accept-language'),
  })
  const copy = messages[locale]

  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: copy.databaseUnavailable }, { status: 503 })
  }

  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: copy.invalidEmail }, { status: 400 })
  }

  const email = normalizeEmail(parsed.data.email)
  if (!email) {
    return NextResponse.json({ error: copy.invalidEmail }, { status: 400 })
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
        { error: copy.cooldown.replace('{seconds}', String(retryAfterSeconds)), retryAfterSeconds },
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

  const tpl = existingUser ? renderSigninOtpEmail(code, locale) : renderSignupOtpEmail(code, locale)
  const from = process.env.EMAIL_FROM || DEFAULT_EMAIL_FROM

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
    return NextResponse.json({ error: copy.sendFailed }, { status: 502 })
  }

  return NextResponse.json({
    ok: true,
    cooldownSeconds: Math.floor(cooldownMs / 1000),
    expiresAt: expiresAt.toISOString(),
  })
}
