import crypto from 'node:crypto'

type HashInput = {
  code: string
  salt: string
  secret: string
}

export function normalizeEmail(email: string): string {
  return String(email || '').trim().toLowerCase()
}

export function resolveOtpSecret(): string {
  return process.env.EMAIL_OTP_SECRET || process.env.NEXTAUTH_SECRET || 'dev-secret'
}

export function generateEmailOtpCode(): string {
  // 6-digit numeric code
  const n = crypto.randomInt(0, 1_000_000)
  return String(n).padStart(6, '0')
}

export function generateEmailOtpSalt(): string {
  return crypto.randomBytes(16).toString('hex')
}

export function hashEmailOtpCode({ code, salt, secret }: HashInput): string {
  const normalized = String(code || '').trim()
  const input = `${salt}:${secret}:${normalized}`
  return crypto.createHash('sha256').update(input).digest('hex')
}

export function timingSafeEqualHex(a: string, b: string): boolean {
  const aBuf = Buffer.from(String(a || ''), 'hex')
  const bBuf = Buffer.from(String(b || ''), 'hex')
  if (aBuf.length !== bBuf.length) return false
  return crypto.timingSafeEqual(aBuf, bBuf)
}

export function sha256Hex(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex')
}

