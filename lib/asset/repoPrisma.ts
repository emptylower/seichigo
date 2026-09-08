import { prisma } from '@/lib/db/prisma'
import type { Asset, AssetR2Fields, AssetRepo, CreateAssetInput } from './repo'

/**
 * 2026-09-08 图片资产迁 R2：不再进程内缓存原图（旧缓存 12MB/24 张常驻，
 * 且变体请求会反复把大 PNG 整体拽进内存——/assets 超限根因之一）。
 * findById 只查元数据（select 排除 bytes）；原始字节按需走 findBytesById。
 */

const ASSET_METADATA_SELECT = {
  id: true,
  ownerId: true,
  contentType: true,
  filename: true,
  storageKey: true,
  byteLength: true,
  width: true,
  height: true,
  createdAt: true,
} as const

export class PrismaAssetRepo implements AssetRepo {
  async create(input: CreateAssetInput): Promise<Asset> {
    return prisma.asset.create({
      data: {
        ...(input.id ? { id: input.id } : {}),
        ownerId: input.ownerId,
        contentType: input.contentType,
        filename: input.filename ?? undefined,
        bytes: Buffer.from(input.bytes),
        storageKey: input.storageKey ?? undefined,
        byteLength: input.byteLength ?? undefined,
        width: input.width ?? undefined,
        height: input.height ?? undefined,
      },
      select: ASSET_METADATA_SELECT,
    })
  }

  async findById(id: string): Promise<Asset | null> {
    return prisma.asset.findUnique({ where: { id }, select: ASSET_METADATA_SELECT })
  }

  async findBytesById(id: string): Promise<Uint8Array | null> {
    const found = await prisma.asset.findUnique({ where: { id }, select: { bytes: true } })
    if (!found?.bytes) return null
    return new Uint8Array(found.bytes)
  }

  async listUnmigratedIds(limit: number): Promise<string[]> {
    const rows = await prisma.asset.findMany({
      where: { storageKey: null },
      orderBy: { createdAt: 'asc' },
      take: limit,
      select: { id: true },
    })
    return rows.map((row) => row.id)
  }

  async countAll(): Promise<number> {
    return prisma.asset.count()
  }

  async countUnmigrated(): Promise<number> {
    return prisma.asset.count({ where: { storageKey: null } })
  }

  async updateR2Fields(id: string, fields: AssetR2Fields): Promise<void> {
    await prisma.asset.update({
      where: { id },
      data: {
        storageKey: fields.storageKey,
        byteLength: fields.byteLength,
        width: fields.width,
        height: fields.height,
      },
      select: { id: true },
    })
  }
}
