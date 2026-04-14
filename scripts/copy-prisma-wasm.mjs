import fs from 'node:fs/promises'
import path from 'node:path'

const sourceDir = path.join(process.cwd(), 'node_modules', '.prisma', 'client')
const serverFunctionsDir = path.join(process.cwd(), '.open-next', 'server-functions')
const wasmFiles = ['query_compiler_bg.wasm']

async function pathExists(target) {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
}

async function copyWasmFiles(targetDir) {
  await fs.mkdir(targetDir, { recursive: true })

  for (const file of wasmFiles) {
    const source = path.join(sourceDir, file)
    if (!(await pathExists(source))) continue

    await fs.copyFile(source, path.join(targetDir, file))
  }
}

async function annotateWasmFiles(targetDir) {
  const indexPath = path.join(targetDir, 'index.js')
  if (!(await pathExists(indexPath))) return

  let indexSource = await fs.readFile(indexPath, 'utf8')
  const annotationLines = wasmFiles.flatMap((file) => [
    `path.join(__dirname, "${file}");`,
    `path.join(process.cwd(), "node_modules/.prisma/client/${file}")`,
  ])

  const missingLines = annotationLines.filter((line) => !indexSource.includes(line))
  if (missingLines.length === 0) return

  indexSource = `${indexSource}\n${missingLines.join('\n')}\n`
  await fs.writeFile(indexPath, indexSource)
}

async function main() {
  if (!(await pathExists(serverFunctionsDir))) {
    throw new Error(`OpenNext server functions directory not found: ${serverFunctionsDir}`)
  }

  const entries = await fs.readdir(serverFunctionsDir, { withFileTypes: true })
  const functionDirs = entries.filter((entry) => entry.isDirectory())

  for (const entry of functionDirs) {
    const targetDir = path.join(serverFunctionsDir, entry.name, 'node_modules', '.prisma', 'client')
    if (!(await pathExists(targetDir))) continue

    await copyWasmFiles(targetDir)
    await annotateWasmFiles(targetDir)
  }
}

main().catch((error) => {
  console.error('[copy-prisma-wasm] failed', error)
  process.exitCode = 1
})
