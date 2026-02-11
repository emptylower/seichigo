import fs from 'fs/promises'
import path from 'path'

function preferredBaseDirs(): string[] {
  const dirs: string[] = []
  const custom = String(process.env.ANITABI_RAW_DIR || '').trim()
  if (custom) dirs.push(custom)
  dirs.push(path.join(process.cwd(), '.cache', 'anitabi', 'raw'))
  dirs.push('/tmp/anitabi/raw')
  return Array.from(new Set(dirs))
}

let resolvedBaseDir: string | null = null

async function ensureBaseDir(): Promise<string> {
  if (resolvedBaseDir) return resolvedBaseDir

  for (const dir of preferredBaseDirs()) {
    try {
      await fs.mkdir(dir, { recursive: true })
      resolvedBaseDir = dir
      return dir
    } catch {
      // Try next candidate path.
    }
  }

  throw new Error('No writable raw storage directory available')
}

async function writeRawFile(datasetVersion: string, name: string, text: string): Promise<string> {
  try {
    const baseDir = await ensureBaseDir()
    const dir = path.join(baseDir, datasetVersion)
    await fs.mkdir(dir, { recursive: true })
    const file = path.join(dir, name)
    await fs.writeFile(file, text, 'utf8')
    return file
  } catch (err) {
    console.warn('[anitabi/rawStore] write skipped', err)
    return ''
  }
}

export async function writeRawJson(datasetVersion: string, name: string, payload: unknown): Promise<string> {
  return writeRawFile(datasetVersion, `${name}.json`, JSON.stringify(payload, null, 2))
}

export async function writeRawText(datasetVersion: string, name: string, text: string): Promise<string> {
  return writeRawFile(datasetVersion, name, text)
}
