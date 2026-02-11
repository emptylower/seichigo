import fs from 'fs/promises'
import path from 'path'

const BASE_DIR = path.join(process.cwd(), '.cache', 'anitabi', 'raw')

export async function writeRawJson(datasetVersion: string, name: string, payload: unknown): Promise<string> {
  const dir = path.join(BASE_DIR, datasetVersion)
  await fs.mkdir(dir, { recursive: true })
  const file = path.join(dir, `${name}.json`)
  await fs.writeFile(file, JSON.stringify(payload, null, 2), 'utf8')
  return file
}

export async function writeRawText(datasetVersion: string, name: string, text: string): Promise<string> {
  const dir = path.join(BASE_DIR, datasetVersion)
  await fs.mkdir(dir, { recursive: true })
  const file = path.join(dir, name)
  await fs.writeFile(file, text, 'utf8')
  return file
}
