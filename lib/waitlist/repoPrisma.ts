import type { WaitlistEntry as PrismaWaitlistEntry } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import type { WaitlistEntry, WaitlistRepo } from './repo'

function toEntry(record: PrismaWaitlistEntry): WaitlistEntry {
  return {
    id: record.id,
    userId: record.userId,
    email: record.email,
    createdAt: record.createdAt,
  }
}

export class PrismaWaitlistRepo implements WaitlistRepo {
  async upsertForUser(userId: string, email: string): Promise<WaitlistEntry> {
    const normalizedEmail = String(email || '').trim()
    const saved = await prisma.waitlistEntry.upsert({
      where: { userId },
      update: { email: normalizedEmail },
      create: { userId, email: normalizedEmail },
    })
    return toEntry(saved)
  }

  async findByUserId(userId: string): Promise<WaitlistEntry | null> {
    const found = await prisma.waitlistEntry.findUnique({ where: { userId } })
    return found ? toEntry(found) : null
  }

  async listAll(): Promise<WaitlistEntry[]> {
    const list = await prisma.waitlistEntry.findMany({ orderBy: { createdAt: 'desc' } })
    return list.map(toEntry)
  }

  async listPage(input: { page: number; pageSize: number; q?: string }): Promise<{
    items: WaitlistEntry[]
    total: number
    page: number
    pageSize: number
  }> {
    const page = Number.isFinite(input.page) ? Math.max(1, Math.floor(input.page)) : 1
    const pageSize = Number.isFinite(input.pageSize) ? Math.min(100, Math.max(1, Math.floor(input.pageSize))) : 20
    const q = String(input.q || '').trim()
    const where = q
      ? {
          OR: [
            { email: { contains: q, mode: 'insensitive' as const } },
            { userId: { contains: q, mode: 'insensitive' as const } },
          ],
        }
      : undefined

    const [items, total] = await Promise.all([
      prisma.waitlistEntry.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.waitlistEntry.count({ where }),
    ])

    return {
      items: items.map(toEntry),
      total,
      page,
      pageSize,
    }
  }
}
