import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
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

  const tempDir = path.join(os.tmpdir(), `seo-spoke-${randomUUID()}`)
  const zipPath = path.join(tempDir, 'artifact.zip')
  try {
    await fs.mkdir(tempDir, { recursive: true })
    await fs.writeFile(zipPath, zipBuffer)

    const listing = spawnSync('unzip', ['-Z1', zipPath], { encoding: 'utf-8' })
    if (listing.status !== 0) return null

    const entries = String(listing.stdout || '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
    const summaryEntry =
      entries.find((entry) => entry.endsWith('/summary.json')) ||
      entries.find((entry) => entry.endsWith('summary.json')) ||
      entries[0]
    if (!summaryEntry) return null

    const extracted = spawnSync('unzip', ['-p', zipPath, summaryEntry], { encoding: 'utf-8', maxBuffer: 5 * 1024 * 1024 })
    if (extracted.status !== 0) return null
    return parseJsonText(String(extracted.stdout || ''))
  } catch {
    return null
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {})
  }
}

