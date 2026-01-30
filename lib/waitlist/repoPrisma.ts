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
}
