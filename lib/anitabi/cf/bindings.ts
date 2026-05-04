import type { R2MirrorBucket } from '@/lib/anitabi/r2Mirror'

export type CfBindingsEnv = {
  MAP_IMAGE_CACHE?: R2MirrorBucket
  NEXT_PUBLIC_MAP_IMAGE_R2_READ_ENABLED?: string
  NEXT_PUBLIC_MAP_IMAGE_R2_WRITE_ENABLED?: string
}

export type CfBindingsCtx = {
  waitUntil?: (promise: Promise<unknown>) => void
}

export type CfBindings = {
  env?: CfBindingsEnv
  ctx?: CfBindingsCtx
}

/**
 * Read the OpenNext-on-Cloudflare request bindings (env + ctx) from the
 * symbol-keyed slot on globalThis that the worker entrypoint populates.
 * Mirrors what `getCloudflareContext` from `@opennextjs/cloudflare` does
 * internally — see node_modules/@opennextjs/cloudflare/dist/api/cloudflare-context.js.
 *
 * Note: this is NOT the same store as `globalThis.__openNextAls`; that ALS
 * exposes `requestContext` (requestId, waitUntil) for per-request work
 * (lib/db/prisma.ts uses it). The cloudflare-context symbol is where
 * `env.MAP_IMAGE_CACHE` actually lives.
 */
const CLOUDFLARE_CONTEXT_SYMBOL = Symbol.for('__cloudflare-context__')

export function getCfBindings(): CfBindings | null {
  const ctx = (globalThis as typeof globalThis & {
    [CLOUDFLARE_CONTEXT_SYMBOL]?: CfBindings
  })[CLOUDFLARE_CONTEXT_SYMBOL]
  return ctx ?? null
}
