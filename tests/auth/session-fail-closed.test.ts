import type { NextAuthOptions, Session } from 'next-auth'
import type { JWT } from 'next-auth/jwt'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type SessionUserRecord = {
  name: string | null
  image: string | null
  mustChangePassword: boolean
  passwordHash: string | null
  disabled: boolean
}

const mocks = vi.hoisted(() => ({
  findUser: vi.fn<() => Promise<SessionUserRecord | null>>(),
  getServerSession: vi.fn<() => Promise<Session | null>>(),
}))

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    user: {
      findUnique: mocks.findUser,
    },
  },
}))

vi.mock('next-auth/next', () => ({
  getServerSession: mocks.getServerSession,
}))

import { authOptions } from '@/lib/auth/options'
import { getServerAuthSession } from '@/lib/auth/session'

type SessionCallback = NonNullable<NonNullable<NextAuthOptions['callbacks']>['session']>

const sessionCallback = authOptions.callbacks?.session as SessionCallback

function createSession(): Session {
  return {
    expires: '2099-01-01T00:00:00.000Z',
    user: {
      id: 'user-1',
      email: 'user@example.com',
      name: 'Token Name',
      image: 'token-image.jpg',
    },
  }
}

async function refreshSession(): Promise<Session> {
  const session = createSession()
  const token: JWT = {
    id: 'user-1',
    email: 'user@example.com',
    name: 'Token Name',
    picture: 'token-image.jpg',
    mustChangePassword: false,
  }

  return (await sessionCallback({ session, token } as Parameters<SessionCallback>[0])) as Session
}

describe('auth session user verification', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('fails closed and logs when the session user query throws', async () => {
    const queryError = new Error('database unavailable')
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const observedSessions: Session[] = []
    mocks.findUser.mockRejectedValue(queryError)
    mocks.getServerSession.mockImplementation(async () => {
      const refreshed = await refreshSession()
      observedSessions.push(refreshed)
      return refreshed
    })

    await expect(getServerAuthSession()).resolves.toBeNull()
    const refreshed = observedSessions[0]
    expect(refreshed.user.verified).toBe(false)
    expect(refreshed.user.disabled).toBe(true)
    expect(refreshed.user.mustChangePassword).toBe(true)
    expect(refreshed.user.needsPasswordSetup).toBe(true)
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringMatching(/^\[degraded:auth\.session-user\]/),
      queryError
    )
  })

  it('rejects an unverified session even if its flags appear permissive', async () => {
    const session = createSession()
    session.user.verified = false
    session.user.disabled = false
    session.user.mustChangePassword = false
    session.user.needsPasswordSetup = false
    mocks.getServerSession.mockResolvedValue(session)

    await expect(getServerAuthSession()).resolves.toBeNull()
  })

  it('rejects a user disabled in the database', async () => {
    mocks.findUser.mockResolvedValue({
      name: 'Disabled User',
      image: null,
      mustChangePassword: false,
      passwordHash: 'hash',
      disabled: true,
    })

    const refreshed = await refreshSession()
    expect(refreshed.user.verified).toBe(true)
    expect(refreshed.user.disabled).toBe(true)

    mocks.getServerSession.mockResolvedValue(refreshed)
    await expect(getServerAuthSession()).resolves.toBeNull()
  })

  it('returns a verified user with all session flags from the database', async () => {
    mocks.findUser.mockResolvedValue({
      name: 'Database User',
      image: 'database-image.jpg',
      mustChangePassword: true,
      passwordHash: null,
      disabled: false,
    })

    const refreshed = await refreshSession()
    mocks.getServerSession.mockResolvedValue(refreshed)

    await expect(getServerAuthSession()).resolves.toBe(refreshed)
    expect(refreshed.user).toMatchObject({
      name: 'Database User',
      image: 'database-image.jpg',
      verified: true,
      disabled: false,
      mustChangePassword: true,
      needsPasswordSetup: true,
    })
  })

  it('preserves the existing fallback when the user is not found', async () => {
    mocks.findUser.mockResolvedValue(null)

    const refreshed = await refreshSession()
    mocks.getServerSession.mockResolvedValue(refreshed)

    await expect(getServerAuthSession()).resolves.toBe(refreshed)
    expect(refreshed.user).toMatchObject({
      verified: true,
      disabled: false,
      mustChangePassword: false,
      needsPasswordSetup: false,
    })
  })
})
