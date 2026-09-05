/**
 * RoutePreviewMap 的 props 同步栅栏：地图 style 未就绪（初次 load 前、
 * provider failover setStyle 后重载中）时，props 更新不能丢——只保留最新
 * 一次，等 load/style.load/idle 任一就绪信号（markReady）补执行；
 * failover 换 style 时 reset 回挂起态（旧 style 的挂起更新作废）。
 */
export type PendingSync = {
  /** ready 时立即执行；否则覆盖式记住最新一次 */
  request: (apply: () => void) => void
  /** 标记就绪并执行挂起的那次（若有） */
  markReady: () => void
  /** 回到挂起态并丢弃挂起的更新 */
  reset: () => void
}

export function createPendingSync(): PendingSync {
  let ready = false
  let pending: (() => void) | null = null
  return {
    request(apply) {
      if (ready) {
        apply()
        return
      }
      pending = apply
    },
    markReady() {
      ready = true
      const apply = pending
      pending = null
      apply?.()
    },
    reset() {
      ready = false
      pending = null
    },
  }
}
