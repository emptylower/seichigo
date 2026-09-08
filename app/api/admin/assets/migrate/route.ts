import { getServerAuthSession } from '@/lib/auth/session'
import { PrismaAssetRepo } from '@/lib/asset/repoPrisma'
import { createAdminAssetsMigrateHandlers } from '@/lib/asset/adminMigrate'

export const runtime = 'nodejs'

const repo = new PrismaAssetRepo()
const handlers = createAdminAssetsMigrateHandlers({
  assetRepo: repo,
  getSession: getServerAuthSession,
})

export async function POST(req: Request) {
  return handlers.POST(req)
}

export async function GET() {
  return handlers.GET()
}
