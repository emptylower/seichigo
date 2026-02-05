import { timingSafeEqual } from 'crypto'
import type { Session } from 'next-auth'
import type { AiApiDeps } from '@/lib/ai/api'

export type AiAuthResult =
  | { ok: true; mode: 'token' }
  | { ok: true; mode: 'session'; session: Session }
  | { ok: false; reason: 'unauthorized' | 'forbidden' }

function parseBearerToken(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const m = /^bearer\s+(.+)$/i.exec(trimmed)
  const token = (m?.[1] || '').trim()
  return token ? token : null
}

function getRequestToken(req: Request): string | null {
  const auth = req.headers.get('authorization')
  if (auth) {
    const token = parseBearerToken(auth)
    if (token) return token
  }

  const fallback = req.headers.get('x-ai-key')
  const token = String(fallback || '').trim()
  return token ? token : null
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

function getAllowedTokens(): string[] {
  const raw = [process.env.SEICHIGO_AI_API_KEY, process.env.AI_API_KEY].filter(Boolean).join(',')
  return raw
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
}

function hasValidToken(req: Request): boolean {
  const token = getRequestToken(req)
  if (!token) return false

  const allowed = getAllowedTokens()
  if (!allowed.length) return false

  return allowed.some((key) => safeEqual(token, key))
}

export async function authorizeAiRequest(req: Request, deps: AiApiDeps): Promise<AiAuthResult> {
  if (hasValidToken(req)) {
    return { ok: true, mode: 'token' }
  }

  const session = await deps.getSession()
  if (!session?.user?.email) {
    return { ok: false, reason: 'unauthorized' }
  }

  if (!deps.isAdminEmail(session.user.email)) {
    return { ok: false, reason: 'forbidden' }
  }

  return { ok: true, mode: 'session', session }
}

