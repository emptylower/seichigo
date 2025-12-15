import { afterEach, describe, expect, it, vi } from 'vitest'
import { sendMail } from '@/lib/email/sender'

function snapshotEnv() {
  return { ...process.env }
}

function restoreEnv(original: Record<string, string | undefined>) {
  for (const key of Object.keys(process.env)) {
    if (!(key in original)) delete process.env[key]
  }
  for (const [key, value] of Object.entries(original)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

describe.sequential('sendMail', () => {
  const originalEnv = snapshotEnv()
  const originalFetch = globalThis.fetch

  afterEach(() => {
    restoreEnv(originalEnv)
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('uses Resend when RESEND_API_KEY is set', async () => {
    process.env.RESEND_API_KEY = 're_test_123'
    process.env.NODE_ENV = 'production'
    delete process.env.EMAIL_SERVER
    delete process.env.EMAIL_SERVER_HOST
    delete process.env.EMAIL_SERVER_PORT
    delete process.env.EMAIL_SERVER_USER
    delete process.env.EMAIL_SERVER_PASSWORD

    const fetchMock = vi.fn(async (_url: string, _init: any) => ({ ok: true })) as any
    globalThis.fetch = fetchMock

    await sendMail({
      to: 'test@example.com',
      from: 'SeichiGo <no-reply@example.com>',
      subject: 'Test',
      text: 'Hello',
      html: '<p>Hello</p>',
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://api.resend.com/emails')
    expect(init?.method).toBe('POST')
    expect(init?.headers?.authorization).toBe(`Bearer ${process.env.RESEND_API_KEY}`)

    const body = JSON.parse(init.body)
    expect(body).toMatchObject({
      from: 'SeichiGo <no-reply@example.com>',
      to: ['test@example.com'],
      subject: 'Test',
      text: 'Hello',
      html: '<p>Hello</p>',
    })
  })

  it('logs to console in development when no provider is configured', async () => {
    delete process.env.RESEND_API_KEY
    delete process.env.EMAIL_SERVER
    delete process.env.EMAIL_SERVER_HOST
    delete process.env.EMAIL_SERVER_PORT
    delete process.env.EMAIL_SERVER_USER
    delete process.env.EMAIL_SERVER_PASSWORD
    process.env.NODE_ENV = 'development'

    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await expect(
      sendMail({
        to: 'dev@example.com',
        from: 'SeichiGo <no-reply@example.com>',
        subject: 'Dev test',
        text: 'dev',
        html: '<p>dev</p>',
      })
    ).resolves.toBeUndefined()
    expect(log).toHaveBeenCalled()
  })

  it('throws in production when no provider is configured', async () => {
    delete process.env.RESEND_API_KEY
    delete process.env.EMAIL_SERVER
    delete process.env.EMAIL_SERVER_HOST
    delete process.env.EMAIL_SERVER_PORT
    delete process.env.EMAIL_SERVER_USER
    delete process.env.EMAIL_SERVER_PASSWORD
    process.env.NODE_ENV = 'production'

    await expect(
      sendMail({
        to: 'prod@example.com',
        from: 'SeichiGo <no-reply@example.com>',
        subject: 'Prod test',
        text: 'prod',
        html: '<p>prod</p>',
      })
    ).rejects.toThrow(/Email provider is not configured/i)
  })
})

