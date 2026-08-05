import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

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
})
