import { backfillArticleCityLinks } from '@/lib/city/backfillArticleCityLinks'
import { prisma } from '@/lib/db/prisma'

const isDryRun = !process.argv.includes('--execute')
const allowCreateMissingCity = process.argv.includes('--create-missing-city')
const limitRaw = process.argv.find((x) => x.startsWith('--limit='))
const cursorRaw = process.argv.find((x) => x.startsWith('--cursor='))

function parseNumberFlag(value: string | undefined): number | undefined {
  if (!value) return undefined
  const raw = value.split('=')[1]
  const v = Number(raw)
  if (!Number.isFinite(v)) return undefined
  return v
}

function parseStringFlag(value: string | undefined): string | null | undefined {
  if (!value) return undefined
  const raw = value.split('=')[1]
  const s = String(raw || '').trim()
  return s ? s : null
}

async function main() {
  const limit = parseNumberFlag(limitRaw)
  const cursor = parseStringFlag(cursorRaw)

  const result = await backfillArticleCityLinks({
    dryRun: isDryRun,
    createMissingCity: allowCreateMissingCity,
    limit,
    cursor,
  })

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

main()
  .catch((err) => {
    console.error('Fatal error:', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
