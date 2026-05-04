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
 * Read the OpenNext-on-Cloudflare request context from the AsyncLocalStorage
 * the runtime publishes on globalThis. The rest of the app accesses bindings
 * through this helper instead of importing `getCloudflareContext` from
 * `@opennextjs/cloudflare` directly. See lib/db/prisma.ts for the same pattern
 * used for the Prisma waitUntil hook.
 */
export function getCfBindings(): CfBindings | null {
  const als = (globalThis as typeof globalThis & {
    __openNextAls?: { getStore?: () => CfBindings | undefined }
  }).__openNextAls

  if (!als || typeof als.getStore !== 'function') return null
  return als.getStore?.() ?? null
}
