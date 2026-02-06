import fs from 'node:fs/promises'
import path from 'node:path'
import JSZip from 'jszip'
import { normalizeSummary } from './validate'
import type { SpokeFactorySummary } from './types'

export async function writeSummaryArtifact(filePath: string, summary: SpokeFactorySummary): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, JSON.stringify(summary, null, 2), 'utf-8')
}

export async function readSummaryArtifact(filePath: string): Promise<SpokeFactorySummary | null> {
  const raw = await fs.readFile(filePath, 'utf-8').catch(() => '')
  if (!raw) return null
  let parsed: unknown = null
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  return normalizeSummary(parsed)
}

function parseJsonText(raw: string): SpokeFactorySummary | null {
  if (!raw.trim()) return null
  let parsed: unknown = null
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  return normalizeSummary(parsed)
}

export async function extractSummaryFromZipBuffer(zipBuffer: Buffer): Promise<SpokeFactorySummary | null> {
  if (!zipBuffer || zipBuffer.length === 0) return null

  // If the payload is plain JSON already, parse directly.
  const asText = zipBuffer.toString('utf-8')
  const direct = parseJsonText(asText)
  if (direct) return direct

  try {
    const zip = await JSZip.loadAsync(zipBuffer)
    const entries = Object.values(zip.files).filter((entry) => !entry.dir)
    const summaryEntry =
      entries.find((entry) => entry.name.endsWith('/summary.json')) ||
      entries.find((entry) => entry.name.endsWith('summary.json')) ||
      entries[0]
    if (!summaryEntry) return null

    const extracted = await summaryEntry.async('string')
    return parseJsonText(extracted)
  } catch {
    return null
  }
}
