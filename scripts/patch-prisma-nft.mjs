import fs from 'node:fs/promises'
import path from 'node:path'

const serverRoot = path.join(process.cwd(), '.next', 'server')
const prismaCompilerJs = 'node_modules/.prisma/client/query_compiler_bg.js'
const prismaCompilerWasm = 'node_modules/.prisma/client/query_compiler_bg.wasm'

async function collectNftFiles(rootDir) {
  const results = []

  async function walk(currentDir) {
    const entries = await fs.readdir(currentDir, { withFileTypes: true })
    for (const entry of entries) {
      const nextPath = path.join(currentDir, entry.name)
      if (entry.isDirectory()) {
        await walk(nextPath)
        continue
      }

      if (entry.isFile() && entry.name.endsWith('.nft.json')) {
        results.push(nextPath)
      }
    }
  }

  await walk(rootDir)
  return results
}

async function main() {
  const nftFiles = await collectNftFiles(serverRoot)

  for (const nftFile of nftFiles) {
    const raw = await fs.readFile(nftFile, 'utf8')
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed.files)) continue

    let changed = false
    for (const file of [...parsed.files]) {
      if (!file.includes(prismaCompilerJs)) continue

      const wasmFile = file.replace(prismaCompilerJs, prismaCompilerWasm)
      if (parsed.files.includes(wasmFile)) continue

      parsed.files.push(wasmFile)
      changed = true
    }

    if (!changed) continue

    await fs.writeFile(nftFile, JSON.stringify(parsed))
  }
}

main().catch((error) => {
  console.error('[patch-prisma-nft] failed', error)
  process.exitCode = 1
})
