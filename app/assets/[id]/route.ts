import { createGetAssetHandler } from '@/lib/asset/handlers'
import { PrismaAssetRepo } from '@/lib/asset/repoPrisma'

export const runtime = 'nodejs'

const repo = new PrismaAssetRepo()
const getAsset = createGetAssetHandler({ assetRepo: repo })

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return getAsset(req, ctx)
}

