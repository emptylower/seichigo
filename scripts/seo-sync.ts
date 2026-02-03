import { syncGscData } from '../lib/seo/gsc/sync'

async function main() {
  const args = process.argv.slice(2)
  const daysIndex = args.indexOf('--days')
  const days = daysIndex >= 0 ? parseInt(args[daysIndex + 1]) : 7

  if (isNaN(days) || days <= 0) {
    console.error('Error: --days must be a positive number')
    process.exit(1)
  }

  console.log(`Syncing GSC data for last ${days} days...`)

  try {
    const count = await syncGscData(days)
    console.log(`✓ Synced ${count} rows from GSC`)
    process.exit(0)
  } catch (error) {
    console.error('✗ GSC sync failed:', error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}

main()
