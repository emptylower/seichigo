import { getServerAuthSession } from '@/lib/auth/session'
import { createPostAssetsHandler } from '@/lib/asset/handlers'
import { PrismaAssetRepo } from '@/lib/asset/repoPrisma'

export const runtime = 'nodejs'

const repo = new PrismaAssetRepo()
const postAssets = createPostAssetsHandler({
  assetRepo: repo,
  getSession: getServerAuthSession,
})

export async function POST(req: Request) {
  return postAssets(req)
}

