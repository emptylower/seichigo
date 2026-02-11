import { getAnitabiApiDeps } from '@/lib/anitabi/api'
import { runAnitabiSync } from '@/lib/anitabi/sync/workflow'

function parseMode(argv: string[]): 'full' | 'delta' | 'dryRun' {
  const raw = String(argv[2] || 'delta').trim().toLowerCase()
  if (raw === 'full' || raw === 'daily') return 'full'
  if (raw === 'dryrun' || raw === 'dry-run') return 'dryRun'
  return 'delta'
}

async function main() {
  const mode = parseMode(process.argv)
  const deps = await getAnitabiApiDeps()
  const report = await runAnitabiSync(deps, { mode })
  console.log(JSON.stringify(report, null, 2))
  if (report.status !== 'ok') {
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('[scripts/anitabi-sync] failed', err)
  process.exit(1)
})
