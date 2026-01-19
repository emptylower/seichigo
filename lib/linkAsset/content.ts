import fs from 'node:fs/promises'
import path from 'node:path'

function normalizeContentPath(input: string): string | null {
  const raw = String(input || '').trim()
  if (!raw) return null
  if (!raw.startsWith('/content/')) return null
  if (raw.includes('..')) return null
  return raw
}

export async function readLinkAssetMarkdown(contentFile: string | undefined): Promise<string | null> {
  const normalized = typeof contentFile === 'string' ? normalizeContentPath(contentFile) : null
  if (!normalized) return null

  const fsPath = path.join(process.cwd(), normalized.replace(/^[\/]+/, ''))
  const raw = await fs.readFile(fsPath, 'utf-8').catch(() => null)
  return raw
}
