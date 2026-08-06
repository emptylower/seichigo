import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const runtimePackageDir = path.join(repoRoot, 'packages/prisma-client-runtime')

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

  it('packs only the declared runtime entry files', () => {
    const packageJson = JSON.parse(
      readFileSync(path.join(runtimePackageDir, 'package.json'), 'utf8')
    ) as { files?: string[] }

    expect(packageJson.files).toEqual(['index.d.ts', 'node.cjs', 'workerd.cjs'])
    expect(existsSync(path.join(runtimePackageDir, 'prisma-client-runtime'))).toBe(false)
  })
})
