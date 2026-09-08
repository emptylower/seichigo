import type { ShareLink as PrismaShareLink } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import { isPrismaKnownRequestError } from '@/lib/db/prismaError'
import type { SupportedLocale } from '@/lib/i18n/types'
import type {
  CreateShareLinkInput,
  FindRecentDuplicateInput,
  ShareLinkRecord,
  ShareLinkRepo,
} from '@/lib/share/repo'
import type { ShareCardLayout } from '@/lib/share/types'

function toRecord(row: PrismaShareLink): ShareLinkRecord {
  return {
    ...row,
    locale: row.locale as SupportedLocale,
    layout: row.layout as ShareCardLayout,
  }
}

export class PrismaShareLinkRepo implements ShareLinkRepo {
  async create(input: CreateShareLinkInput): Promise<ShareLinkRecord> {
    const created = await prisma.shareLink.create({
      data: {
        code: input.code,
        kind: 'point',
        pointId: input.pointId,
        bangumiId: input.bangumiId,
        locale: input.locale,
        layout: input.layout,
        userId: input.userId,
        ipHash: input.ipHash,
      },
    })
    return toRecord(created)
  }

  async findByCode(code: string): Promise<ShareLinkRecord | null> {
    const found = await prisma.shareLink.findUnique({ where: { code } })
    return found ? toRecord(found) : null
  }

  async findRecentDuplicate(input: FindRecentDuplicateInput): Promise<ShareLinkRecord | null> {
    const found = await prisma.shareLink.findFirst({
      where: {
        pointId: input.pointId,
        locale: input.locale,
        layout: input.layout,
        userId: input.userId,
        // 匿名链再按 ipHash 收窄，登录链 ipHash 恒为 null、只按 userId 匹配
        ...(input.userId === null ? { ipHash: input.ipHash } : {}),
        createdAt: { gte: input.since },
      },
      orderBy: { createdAt: 'desc' },
    })
    return found ? toRecord(found) : null
  }

  async countByIpHashSince(ipHash: string, since: Date): Promise<number> {
    return prisma.shareLink.count({ where: { ipHash, createdAt: { gte: since } } })
  }

  async countUploadsByUserSince(userId: string, since: Date): Promise<number> {
    return prisma.shareLink.count({
      where: { userId, imageKey: { not: null }, createdAt: { gte: since } },
    })
  }

  async markUploaded(
    code: string,
    input: { imageKey: string; userId: string },
  ): Promise<ShareLinkRecord | null> {
    try {
      const updated = await prisma.shareLink.update({
        where: { code },
        data: { imageKey: input.imageKey, userId: input.userId },
      })
      return toRecord(updated)
    } catch (error) {
      if (isPrismaKnownRequestError(error) && error.code === 'P2025') return null
      throw error
    }
  }

  async incrementClicks(code: string): Promise<void> {
    // updateMany：短码不存在时是 count=0 而不是抛 P2025，正好适合 fire-and-forget
    await prisma.shareLink.updateMany({ where: { code }, data: { clicks: { increment: 1 } } })
  }
}
