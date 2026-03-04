#!/usr/bin/env node

import { promises as fs } from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const BUDGET_TARGETS = ['app', 'components', 'lib']
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'])
const ALLOWLIST_PATH = path.join(ROOT, 'line-budget.allowlist.json')

function toPosix(filePath) {
  return filePath.split(path.sep).join('/')
}

async function listFiles(rootDir) {
  const out = []

  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === '.git') continue
      const abs = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(abs)
        continue
      }
      if (!entry.isFile()) continue
      if (!SOURCE_EXTENSIONS.has(path.extname(entry.name))) continue
      out.push(abs)
    }
  }

  await walk(rootDir)
  return out
}

async function readAllowlist() {
  const raw = await fs.readFile(ALLOWLIST_PATH, 'utf8')
  const parsed = JSON.parse(raw)
  const budget = Number(parsed.lineBudget)
  const files = parsed.files && typeof parsed.files === 'object' ? parsed.files : {}
  return {
    budget: Number.isFinite(budget) ? Math.floor(budget) : 800,
    files,
  }
}

async function countLines(absPath) {
  const text = await fs.readFile(absPath, 'utf8')
  if (text.length === 0) return 0
  const lines = text.split(/\r?\n/)
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop()
  }
  return lines.length
}

function printGroup(title, lines) {
  if (lines.length === 0) return
  console.error(`\n${title}`)
  for (const line of lines) {
    console.error(`- ${line}`)
  }
}

async function main() {
  const { budget, files: allowlist } = await readAllowlist()
  const seen = new Map()
  const hardViolations = []
  const growthViolations = []
  const staleAllowlist = []
  const removableAllowlist = []
  const decreased = []

  const absTargets = BUDGET_TARGETS.map((dir) => path.join(ROOT, dir))
  for (const dir of absTargets) {
    const files = await listFiles(dir)
    for (const abs of files) {
      const rel = toPosix(path.relative(ROOT, abs))
      const lineCount = await countLines(abs)
      seen.set(rel, lineCount)

      if (lineCount <= budget) {
        if (Object.prototype.hasOwnProperty.call(allowlist, rel)) {
          removableAllowlist.push(`${rel} is now ${lineCount} lines (<= ${budget}), remove from allowlist`)
        }
        continue
      }

      const allowedMax = Number(allowlist[rel])
      if (!Number.isFinite(allowedMax)) {
        hardViolations.push(`${rel} has ${lineCount} lines (budget: ${budget})`)
        continue
      }

      if (lineCount > allowedMax) {
        growthViolations.push(`${rel} grew to ${lineCount} lines (allowlist max: ${allowedMax})`)
      } else if (lineCount < allowedMax) {
        decreased.push(`${rel} decreased ${allowedMax} -> ${lineCount}`)
      }
    }
  }

  for (const [allowPath, allowMax] of Object.entries(allowlist)) {
    if (!seen.has(allowPath)) {
      staleAllowlist.push(`${allowPath} (allowlist max: ${allowMax}) no longer exists or is out of budget scope`)
    }
  }

  printGroup('Line budget hard violations', hardViolations)
  printGroup('Allowlist monotonic violations', growthViolations)
  printGroup('Stale allowlist entries', staleAllowlist)
  printGroup('Allowlist entries ready to remove', removableAllowlist)
  printGroup('Files decreased (update allowlist max to keep monotonic rule)', decreased)

  if (hardViolations.length || growthViolations.length || staleAllowlist.length || removableAllowlist.length) {
    console.error('\nline-budget: FAILED')
    process.exit(1)
  }

  console.log('line-budget: OK')
  if (decreased.length) {
    console.log('line-budget: some allowlist files shrank; update line-budget.allowlist.json to lock in lower caps')
  }
}

main().catch((error) => {
  console.error('line-budget: FAILED with unexpected error')
  console.error(error)
  process.exit(1)
})
