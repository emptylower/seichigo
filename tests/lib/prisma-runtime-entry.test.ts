import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const runtimePackageDir = path.join(repoRoot, 'packages/prisma-client-runtime')
const prismaWorkerdTraceFiles = [
  'node_modules/@seichigo/prisma-client-runtime/workerd.cjs',
  'node_modules/@prisma/client/package.json',
  'node_modules/@prisma/client/wasm.js',
  'node_modules/@prisma/client/runtime/wasm-compiler-edge.js',
  'node_modules/.prisma/client/package.json',
  'node_modules/.prisma/client/wasm.js',
  'node_modules/.prisma/client/wasm-worker-loader.mjs',
  'node_modules/.prisma/client/query_compiler_bg.js',
  'node_modules/.prisma/client/query_compiler_bg.wasm',
]

function resolvePrismaClient(conditions?: string) {
  const args = conditions ? [`--conditions=${conditions}`] : []
  args.push('-e', "process.stdout.write(require.resolve('@seichigo/prisma-client-runtime'))")

  return execFileSync(process.execPath, args, {
    cwd: repoRoot,
    encoding: 'utf8',
  }).replaceAll(path.sep, '/')
}

describe('Prisma runtime entry', () => {
  it('uses the Node loader during build-time prerendering', () => {
    expect(resolvePrismaClient()).toMatch(
      /\/node_modules\/@seichigo\/prisma-client-runtime\/node\.cjs$/
    )
  })

  it('uses the WASM loader in the Cloudflare Worker bundle', () => {
    expect(resolvePrismaClient('workerd')).toMatch(
      /\/node_modules\/@seichigo\/prisma-client-runtime\/workerd\.cjs$/
    )
  })

  it('traces the complete Prisma workerd dependency chain', () => {
    const nextConfigSource = readFileSync(path.join(repoRoot, 'next.config.ts'), 'utf8')

    for (const tracedFile of prismaWorkerdTraceFiles) {
      expect(nextConfigSource).toContain(`'${tracedFile}'`)
      expect(existsSync(path.join(repoRoot, tracedFile))).toBe(true)
    }
  })

  it('maps the workerd compiler loader to the Worker WASM module', () => {
    const generatedPackage = JSON.parse(
      readFileSync(path.join(repoRoot, 'node_modules/.prisma/client/package.json'), 'utf8')
    ) as {
      imports?: Record<string, Record<string, string>>
    }
    const generatedWasmClient = readFileSync(
      path.join(repoRoot, 'node_modules/.prisma/client/wasm.js'),
      'utf8'
    )
    const workerLoader = readFileSync(
      path.join(repoRoot, 'node_modules/.prisma/client/wasm-worker-loader.mjs'),
      'utf8'
    )

    expect(generatedWasmClient).toContain("require('@prisma/client/runtime/wasm-compiler-edge.js')")
    expect(generatedWasmClient).toContain("import('#wasm-compiler-loader')")
    expect(generatedPackage.imports?.['#wasm-compiler-loader']?.workerd).toBe(
      './wasm-worker-loader.mjs'
    )
    expect(workerLoader).toContain("import('./query_compiler_bg.wasm')")
  })

  it('packs only the declared runtime entry files', () => {
    const packageJson = JSON.parse(
      readFileSync(path.join(runtimePackageDir, 'package.json'), 'utf8')
    ) as { files?: string[] }

    expect(packageJson.files).toEqual(['index.d.ts', 'node.cjs', 'workerd.cjs'])
    expect(existsSync(path.join(runtimePackageDir, 'prisma-client-runtime'))).toBe(false)
  })
})
