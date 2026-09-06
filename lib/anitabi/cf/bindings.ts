import type { R2MirrorBucket } from '@/lib/anitabi/r2Mirror'

// Structural subset of worker-configuration.d.ts's generated ImagesBinding.
type ImagesBinding = {
  input(stream: ReadableStream<Uint8Array>, options?: { encoding?: 'base64' }): ImageTransformer
}

type ImageTransformer = {
  transform(transform: {
    width?: number
    fit?: 'scale-down' | 'contain' | 'pad' | 'squeeze' | 'cover' | 'crop'
  }): ImageTransformer
  output(options: {
    format: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' | 'image/avif' | 'rgb' | 'rgba'
    quality?: number
  }): Promise<{ response(): Response }>
}

type EmailAddress = {
  name: string
  email: string
}

type EmailSendResult = {
  messageId: string
}

export type SendEmailBinding = {
  send(message: {
    from: string | EmailAddress
    to: string | string[]
    subject: string
    replyTo?: string | EmailAddress
    text?: string
    html?: string
  }): Promise<EmailSendResult>
}

export type CfBindingsEnv = {
  EMAIL?: SendEmailBinding
  MAP_IMAGE_CACHE?: R2MirrorBucket
  IMAGES?: ImagesBinding
  NEXT_PUBLIC_MAP_IMAGE_R2_READ_ENABLED?: string
  NEXT_PUBLIC_MAP_IMAGE_R2_WRITE_ENABLED?: string
  /**
   * 2026-09-06 §0.3：规划 run 队列（Cloudflare Queues 生产者绑定的结构子集）。
   * 存在时 POST /api/me/plans/:id/agent 投递队列并返回 202；无绑定（next dev、
   * vitest）走现有 SSE 内联路径。
   */
  PLAN_AGENT_QUEUE?: { send(body: unknown): Promise<void> }
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
