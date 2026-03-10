import type { Session } from 'next-auth'
import { prisma } from '@/lib/db/prisma'
import { getAnimeById } from '@/lib/anime/getAllAnime'
import { safeRevalidatePath } from '@/lib/next/revalidate'
import { isValidAnimeId, normalizeAnimeId } from '@/lib/anime/id'

export type AnimeApiDeps = {
  prisma: typeof prisma
  getSession: () => Promise<Session | null>
  getAnimeById: typeof getAnimeById
  safeRevalidatePath: typeof safeRevalidatePath
  isValidAnimeId: typeof isValidAnimeId
  normalizeAnimeId: typeof normalizeAnimeId
}

let cached: AnimeApiDeps | null = null

export async function getAnimeApiDeps(): Promise<AnimeApiDeps> {
  if (cached) return cached

  const { getServerAuthSession } = await import('@/lib/auth/session')

  cached = {
    prisma,
    getSession: getServerAuthSession,
    getAnimeById,
    safeRevalidatePath,
    isValidAnimeId,
    normalizeAnimeId,
  }

  return cached
}
