import type { Prisma } from '@prisma/client'

export function isPrismaKnownRequestError(error: unknown): error is Prisma.PrismaClientKnownRequestError {
  if (!error || typeof error !== 'object') return false

  const candidate = error as { name?: unknown; code?: unknown; clientVersion?: unknown }
  return candidate.name === 'PrismaClientKnownRequestError'
    && typeof candidate.code === 'string'
    && typeof candidate.clientVersion === 'string'
}
