import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderSigninOtpEmail, renderSignupOtpEmail } from '@/lib/email/templates/seichigoOtp'

const mocks = vi.hoisted(() => ({
  findOtp: vi.fn<() => Promise<{ createdAt: Date } | null>>(),
  createOtp: vi.fn(),
  findUser: vi.fn<() => Promise<{ id: string } | null>>(),
  sendMail: vi.fn(),
}))

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    emailOtp: { findFirst: mocks.findOtp, create: mocks.createOtp },
    user: { findUnique: mocks.findUser },
  },
}))

vi.mock('@/lib/email/sender', () => ({ sendMail: mocks.sendMail }))

vi.mock('@/lib/auth/emailOtp', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/auth/emailOtp')>(),
  generateEmailOtpCode: () => '123456',
}))

import { POST } from '@/app/api/auth/request-code/route'

function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/auth/request-code', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

describe('request-code locale', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('DATABASE_URL', 'postgres://unit-test')
    vi.stubEnv('NEXTAUTH_SECRET', 'unit-test-secret')
    vi.stubEnv('EMAIL_OTP_COOLDOWN_SECONDS', '60')
    vi.stubEnv('EMAIL_OTP_TTL_MINUTES', '10')
    mocks.findOtp.mockResolvedValue(null)
    mocks.findUser.mockResolvedValue(null)
    mocks.createOtp.mockResolvedValue({})
    mocks.sendMail.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it.each([false, true])('uses body ja over cookie and language headers (existing user: %s)', async (existing) => {
    mocks.findUser.mockResolvedValue(existing ? { id: 'user-1' } : null)
    const response = await POST(request({ email: 'user@example.com', locale: 'ja' }, {
      cookie: 'NEXT_LOCALE=zh', 'accept-language': 'en',
    }))

    expect(response.status).toBe(200)
    const render = existing ? renderSigninOtpEmail : renderSignupOtpEmail
    expect(mocks.sendMail).toHaveBeenCalledWith(expect.objectContaining(render('123456', 'ja')))
    expect(mocks.createOtp).toHaveBeenCalledOnce()
  })

  it.each([false, true])('falls back to Accept-Language en (existing user: %s)', async (existing) => {
    mocks.findUser.mockResolvedValue(existing ? { id: 'user-1' } : null)
    const response = await POST(request({ email: 'user@example.com' }, { 'accept-language': 'en-US,en;q=0.9' }))

    expect(response.status).toBe(200)
    const render = existing ? renderSigninOtpEmail : renderSignupOtpEmail
    expect(mocks.sendMail).toHaveBeenCalledWith(expect.objectContaining(render('123456', 'en')))
  })

  it('prefers the locale cookie over Accept-Language', async () => {
    const response = await POST(request({ email: 'user@example.com' }, {
      cookie: 'NEXT_LOCALE=ja', 'accept-language': 'en',
    }))
    expect(response.status).toBe(200)
    expect(mocks.sendMail).toHaveBeenCalledWith(expect.objectContaining(renderSignupOtpEmail('123456', 'ja')))
  })

  it('defaults to Chinese without locale hints', async () => {
    const response = await POST(request({ email: 'user@example.com' }))
    expect(response.status).toBe(200)
    expect(mocks.sendMail).toHaveBeenCalledWith(expect.objectContaining(renderSignupOtpEmail('123456')))
  })

  it('keeps a valid body locale when email validation fails', async () => {
    const response = await POST(request({ email: 'invalid', locale: 'ja' }, { 'accept-language': 'en' }))
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'メールアドレスの形式が正しくありません。' })
    expect(mocks.createOtp).not.toHaveBeenCalled()
    expect(mocks.sendMail).not.toHaveBeenCalled()
  })

  it.each(['fr', null])('ignores unsupported body locale %s and uses Accept-Language for the email', async (locale) => {
    const response = await POST(request({ email: 'user@example.com', locale }, { 'accept-language': 'en' }))
    expect(response.status).toBe(200)
    expect(mocks.sendMail).toHaveBeenCalledWith(expect.objectContaining(renderSignupOtpEmail('123456', 'en')))
    expect(mocks.createOtp).toHaveBeenCalledOnce()
  })

  it.each(['fr', null])('ignores unsupported body locale %s and prefers the locale cookie', async (locale) => {
    const response = await POST(request({ email: 'user@example.com', locale }, {
      cookie: 'NEXT_LOCALE=ja', 'accept-language': 'en',
    }))
    expect(response.status).toBe(200)
    expect(mocks.sendMail).toHaveBeenCalledWith(expect.objectContaining(renderSignupOtpEmail('123456', 'ja')))
  })

  it('localizes malformed JSON errors through the headers', async () => {
    const response = await POST(new Request('http://localhost/api/auth/request-code', {
      method: 'POST', headers: { 'accept-language': 'en' }, body: '{',
    }))
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'Invalid email address.' })
  })

  it('localizes the missing database error with the body locale', async () => {
    vi.stubEnv('DATABASE_URL', '')
    const response = await POST(request({ email: 'user@example.com', locale: 'ja' }))
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'データベースが設定されていません。' })
    expect(mocks.findOtp).not.toHaveBeenCalled()
  })

  it.each([
    ['zh', '请稍候再试（60s）'],
    ['en', 'Please try again in 60s.'],
    ['ja', '60秒後にもう一度お試しください。'],
  ])('localizes %s cooldown errors without changing throttling', async (locale, error) => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-22T00:00:00Z'))
    mocks.findOtp.mockResolvedValue({ createdAt: new Date() })
    const response = await POST(request({ email: 'user@example.com', locale }))
    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('60')
    expect(await response.json()).toEqual({ error, retryAfterSeconds: 60 })
    expect(mocks.createOtp).not.toHaveBeenCalled()
    expect(mocks.sendMail).not.toHaveBeenCalled()
  })

  it.each([
    ['zh', '邮件发送失败，请稍后重试'],
    ['en', 'Failed to send email. Please try again later.'],
    ['ja', 'メールの送信に失敗しました。しばらくしてからお試しください。'],
  ])('localizes %s delivery failures', async (locale, error) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.sendMail.mockRejectedValue(new Error('Delivery unavailable'))
    const response = await POST(request({ email: 'user@example.com', locale }))
    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({ error })
  })
})
