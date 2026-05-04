#!/usr/bin/env node
import { execSync } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import url from 'node:url'

const here = path.dirname(url.fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..', '..', '..')
const wasmFile = path.join(repoRoot, 'node_modules', '.prisma', 'client', 'query_compiler_bg.wasm')
const aliasTarget = path.join(repoRoot, 'node_modules', '@prisma', 'client', 'wasm.js')

async function pathExists(target) {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
}

async function ensurePrismaArtifacts() {
  if (await pathExists(wasmFile) && await pathExists(aliasTarget)) {
    return
  }

  console.log('[anitabi-mirror] running `prisma generate` to populate Worker WASM artifacts…')
  execSync('npx prisma generate', { cwd: repoRoot, stdio: 'inherit' })
}

async function main() {
  await ensurePrismaArtifacts()

  if (!(await pathExists(wasmFile))) {
    throw new Error(`prisma generate did not produce ${wasmFile}; aborting deploy.`)
  }

  if (!(await pathExists(aliasTarget))) {
    throw new Error(`alias target missing: ${aliasTarget}; aborting deploy.`)
  }

  const stat = await fs.stat(wasmFile)
  console.log(`[anitabi-mirror] Prisma WASM ready (${(stat.size / 1024).toFixed(1)} KiB at ${path.relative(repoRoot, wasmFile)})`)
}

main().catch((err) => {
  console.error('[anitabi-mirror] prepare-prisma failed', err)
  process.exitCode = 1
})
