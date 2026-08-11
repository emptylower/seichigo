import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CfBindings } from '@/lib/anitabi/cf/bindings'
import { sendMail } from '@/lib/email/sender'

const CLOUDFLARE_CONTEXT_SYMBOL = Symbol.for('__cloudflare-context__')

function setCloudflareContext(value: CfBindings | undefined) {
  const target = globalThis as typeof globalThis & {
    [CLOUDFLARE_CONTEXT_SYMBOL]?: CfBindings
  }

  if (value) target[CLOUDFLARE_CONTEXT_SYMBOL] = value
  else delete target[CLOUDFLARE_CONTEXT_SYMBOL]
}

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

function setNodeEnv(value: string) {
  ;(process.env as Record<string, string | undefined>).NODE_ENV = value
}

describe.sequential('sendMail', () => {
  const originalEnv = snapshotEnv()

  afterEach(() => {
    restoreEnv(originalEnv)
    setCloudflareContext(undefined)
    vi.restoreAllMocks()
  })

  it('uses the Cloudflare Email Sending binding when available', async () => {
    setNodeEnv('production')

    const send = vi.fn().mockResolvedValue({ messageId: 'cf-message-1' })
    setCloudflareContext({ env: { EMAIL: { send } } })

    await sendMail({
      to: 'test@example.com',
      from: 'SeichiGo <no-reply@seichigo.com>',
      subject: 'Test',
      text: 'Hello',
      html: '<p>Hello</p>',
    })

    expect(send).toHaveBeenCalledWith({
      from: { name: 'SeichiGo', email: 'no-reply@seichigo.com' },
      to: 'test@example.com',
      subject: 'Test',
      text: 'Hello',
      html: '<p>Hello</p>',
    })
  })

  it('logs to console in development when the binding is unavailable', async () => {
    setNodeEnv('development')

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

  it('throws in production when the binding is unavailable', async () => {
    setNodeEnv('production')

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
