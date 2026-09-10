// 底图首次 load 门闩：地图 load 前，把会抢网络的副作用（封面/点位图预取、诊断配置拉取）
// 排队到底图 load 之后再执行，保证 maplibre 的瓦片请求是 JS 就绪后最先发出的网络请求。
// 模块级单例，与 shared.ts 里 prefetchedPointImageUrls 等模块级缓存同一风格。

let basemapFirstLoaded = false
const waiters: Array<() => void> = []

export function isBasemapFirstLoaded(): boolean {
  return basemapFirstLoaded
}

export function markBasemapFirstLoaded(): void {
  if (basemapFirstLoaded) return
  basemapFirstLoaded = true
  const pending = waiters.splice(0, waiters.length)
  for (const run of pending) {
    try {
      run()
    } catch {
      // 等待者自身的异常不应影响其它等待者
    }
  }
}

export function runAfterBasemapFirstLoad(task: () => void): void {
  if (basemapFirstLoaded || typeof window === 'undefined') {
    task()
    return
  }
  waiters.push(task)
}

// 带超时回落的异步等待：超时后按「未门控」处理（resolve(false)），避免地图长时间
// 未就绪时 warmup 等流程被永久挂起。
export function waitForBasemapFirstLoad(timeoutMs: number): Promise<boolean> {
  if (basemapFirstLoaded || typeof window === 'undefined') return Promise.resolve(true)
  return new Promise((resolve) => {
    let settled = false
    const finish = (loaded: boolean) => {
      if (settled) return
      settled = true
      resolve(loaded)
    }
    waiters.push(() => finish(true))
    window.setTimeout(() => finish(false), Math.max(1000, timeoutMs))
  })
}

// 仅供测试隔离使用：模块状态跨用例清理。
export function resetBasemapFirstLoadGateForTests(): void {
  basemapFirstLoaded = false
  waiters.length = 0
}
