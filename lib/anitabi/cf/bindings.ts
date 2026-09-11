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
  /**
   * 2026-09-08 图片资产迁 R2：用户上传图片的原图/变体桶（seichigo-assets）。
   * 结构子集对齐 worker-configuration.d.ts 的 R2Bucket（lib 代码不能直接引用
   * 全局类型——worker-configuration.d.ts 不在任何 tsconfig include 里）。
   */
  ASSET_STORE?: {
    get(key: string): Promise<{
      body: ReadableStream<Uint8Array>
      size: number
      httpMetadata?: { contentType?: string }
    } | null>
    put(
      key: string,
      value: ReadableStream<Uint8Array> | ArrayBuffer | ArrayBufferView,
      options?: { httpMetadata?: { contentType?: string } },
    ): Promise<unknown>
  }
  NEXT_PUBLIC_MAP_IMAGE_R2_READ_ENABLED?: string
  NEXT_PUBLIC_MAP_IMAGE_R2_WRITE_ENABLED?: string
  /**
   * 2026-09-06 §0.3：规划 run 队列（Cloudflare Queues 生产者绑定的结构子集）。
   * 存在时 POST /api/me/plans/:id/agent 投递队列并返回 202；无绑定（next dev、
   * vitest）走现有 SSE 内联路径。
   */
  PLAN_AGENT_QUEUE?: { send(body: unknown): Promise<void> }
  /**
   * 2026-09-11 P1-A：per-run 派发器 DO（DurableObjectNamespace 的结构子集，
   * 对齐 worker-configuration.d.ts——lib 代码不直接引用全局生成类型，同上）。
   * PLAN_AGENT_DISPATCH='do' 且 userId 在 PLAN_AGENT_DO_CANARY_USER_IDS 白名单
   * 时，POST 路由改投 DO alarm 派发（lib/planAgent/dispatch.ts）。
   */
  PLAN_RUN_DISPATCHER?: {
    idFromName(name: string): unknown
    get(id: unknown): { fetch(input: string, init?: RequestInit): Promise<Response> }
  }
  /**
   * 2026-09-10 Hyperdrive：边缘连接池到 Neon（配置侧已禁查询缓存，保
   * run-token 栅栏/计费/session 读最新值）。结构子集对齐
   * worker-configuration.d.ts 的 Hyperdrive——lib 代码只用 connectionString，
   * 不直接引用全局类型（worker-configuration.d.ts 不在任何 tsconfig include 里）。
   */
  HYPERDRIVE?: { connectionString: string }
  HYPERDRIVE_DIRECT?: { connectionString: string }
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
