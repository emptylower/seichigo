import fs from 'node:fs/promises'
import path from 'node:path'
import { extractSpokeCandidatesWithStats, loadExistingSpokeIndex, selectTopicsForGeneration } from '@/lib/seo/spokeFactory/extractCandidates'
import { generateMdxForTopics } from '@/lib/seo/spokeFactory/generateMdx'
import { writeSummaryArtifact } from '@/lib/seo/spokeFactory/artifact'
import { validateGeneratedMdxDoc } from '@/lib/seo/spokeFactory/validate'
import { isSpokeLocale, isSpokeMode, type SpokeFactorySummary, type SpokeLocale, type SpokeMode } from '@/lib/seo/spokeFactory/types'

type CliArgs = {
  mode: SpokeMode
  locales: SpokeLocale[]
  scope: 'all'
  maxTopics: number
  summaryPath: string
}

function parseArg(args: string[], name: string): string | null {
  const index = args.indexOf(name)
  if (index < 0) return null
  return args[index + 1] ?? null
}

function parseCliArgs(): CliArgs {
  const args = process.argv.slice(2)

  const modeRaw = String(parseArg(args, '--mode') || 'preview').trim().toLowerCase()
  const mode: SpokeMode = isSpokeMode(modeRaw) ? modeRaw : 'preview'

  const localesRaw = String(parseArg(args, '--locales') || 'zh,en,ja')
  const locales = localesRaw
    .split(',')
    .map((x) => x.trim().toLowerCase())
    .filter(isSpokeLocale)
  const finalLocales = locales.length > 0 ? Array.from(new Set(locales)) : (['zh', 'en', 'ja'] as SpokeLocale[])

  const scopeRaw = String(parseArg(args, '--scope') || 'all').trim().toLowerCase()
  const scope = scopeRaw === 'all' ? 'all' : 'all'

  const maxTopicsRaw = Number.parseInt(String(parseArg(args, '--max-topics') || '30'), 10)
  const maxTopics = Number.isFinite(maxTopicsRaw) ? Math.max(1, Math.min(30, maxTopicsRaw)) : 30

  const summaryPathRaw = String(parseArg(args, '--summary-path') || '.artifacts/summary.json')
  const summaryPath = summaryPathRaw.trim() || '.artifacts/summary.json'

  return { mode, locales: finalLocales, scope, maxTopics, summaryPath }
}

async function ensureDirForFile(filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
}

async function run(): Promise<number> {
  const input = parseCliArgs()

  const summary: SpokeFactorySummary = {
    mode: input.mode,
    sourceOrigin: 'none',
    sourcePostCount: 0,
    candidateCount: 0,
    selectedTopics: 0,
    generatedFiles: 0,
    skippedExisting: 0,
    skippedLowConfidence: 0,
    skipped: [],
    errors: [],
    topics: [],
    files: [],
    prUrl: null,
  }

  try {
    const extraction = await extractSpokeCandidatesWithStats()
    const candidates = extraction.candidates
    const existing = await loadExistingSpokeIndex()
    const selection = selectTopicsForGeneration(candidates, existing, input.maxTopics)

    summary.sourceOrigin = extraction.sourceOrigin
    summary.sourcePostCount = extraction.sourcePostCount
    summary.candidateCount = extraction.candidateCount
    summary.selectedTopics = selection.selected.length
    summary.skippedExisting = selection.skippedExisting
    summary.skippedLowConfidence = selection.skippedLowConfidence
    summary.skipped = selection.skipped
    summary.topics = selection.selected

    if (input.mode === 'preview') {
      await writeSummaryArtifact(input.summaryPath, summary)
      return 0
    }

    const docs = await generateMdxForTopics(selection.selected, input.locales)
    for (const doc of docs) {
      const validation = validateGeneratedMdxDoc(doc.rawMdx)
      if (!validation.valid) {
        summary.errors.push(...validation.errors.map((err) => `${doc.path}: ${err}`))
        continue
      }

      const fullPath = path.join(process.cwd(), doc.path)
      await ensureDirForFile(fullPath)
      await fs.writeFile(fullPath, doc.rawMdx, 'utf-8')
      summary.files.push({
        path: doc.path,
        locale: doc.locale,
        slug: doc.slug,
      })
    }

    summary.generatedFiles = summary.files.length
  } catch (error) {
    summary.errors.push(error instanceof Error ? error.message : String(error))
  } finally {
    await writeSummaryArtifact(input.summaryPath, summary)
  }

  if (summary.errors.length > 0) {
    return 1
  }
  return 0
}

run()
  .then((code) => {
    process.exit(code)
  })
  .catch((error) => {
    console.error('[seo-spoke-factory] fatal', error)
    process.exit(1)
  })
