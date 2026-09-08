import { getCfBindings } from '@/lib/anitabi/cf/bindings'

/**
 * 点击计数这类后台收尾：有 waitUntil 就挂上去，拿不到（next dev / vitest）就自生自灭。
 * 必须以 ctx 为 this 调用 —— 把 waitUntil 拆下来单独调用会抛 "Illegal invocation"
 * （2026-09-08 资产迁 R2 上线后实测，见 lib/asset/handlers.ts:114-121）。
 */
export function runShareBackground(promise: Promise<unknown>): void {
  const guarded = promise.then(
    () => undefined,
    (error: unknown) => {
      console.error('[share.background.failed]', {
        event: 'share_background_failed',
        error:
          error instanceof Error
            ? { name: error.name, message: error.message }
            : { message: String(error) },
      })
    },
  )
  const ctx = getCfBindings()?.ctx
  if (ctx && typeof ctx.waitUntil === 'function') {
    ctx.waitUntil(guarded)
  }
}
