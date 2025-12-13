import { prisma } from '@/lib/db/prisma'
import type { Asset, AssetRepo, CreateAssetInput } from './repo'

export class PrismaAssetRepo implements AssetRepo {
  async create(input: CreateAssetInput): Promise<Asset> {
    return prisma.asset.create({
      data: {
        ownerId: input.ownerId,
        contentType: input.contentType,
        filename: input.filename ?? undefined,
        bytes: Buffer.from(input.bytes),
      },
    })
  }

  async findById(id: string): Promise<Asset | null> {
    return prisma.asset.findUnique({ where: { id } })
  }
}

