import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createPlanPrewarmQueue, PLAN_PREWARM_IMAGE_TIMEOUT_MS } from '@/app/(authed)/plan/[id]/hooks/planPrewarmQueue'

/** 可手动完成的 loadImage：记录开始顺序与并发峰值 */
function makeLoader() {
  const started: string[] = []
  let inflight = 0
  let maxInflight = 0
  const resolvers = new Map<string, { resolve: () => void; reject: () => void }>()
  const loadImage = vi.fn(
    (url: string) =>
      new Promise<void>((resolve, reject) => {
        started.push(url)
        inflight += 1
        maxInflight = Math.max(maxInflight, inflight)
        resolvers.set(url, {
          resolve: () => {
            inflight -= 1
            resolve()
          },
          reject: () => {
            inflight -= 1
            reject(new Error('load failed'))
          },
        })
      }),
  )
  return {
    started,
    loadImage,
    maxInflight: () => maxInflight,
    resolve: (url: string) => resolvers.get(url)?.resolve(),
    reject: (url: string) => resolvers.get(url)?.reject(),
  }
}

/** 立即放行的槽位：记录 acquire/release 配对 */
function makeSlot() {
  const acquireSlot = vi.fn(async () => ({ release: vi.fn() }))
  return { acquireSlot }
}

async function flushMicrotasks(rounds = 20): Promise<void> {
  for (let i = 0; i < rounds; i++) await Promise.resolve()
}

const URLS = Array.from({ length: 10 }, (_, i) => `/api/img?ref=${i}`)

describe('planPrewarmQueue（并发与顺序）', () => {
  let loader: ReturnType<typeof makeLoader>
  let slot: ReturnType<typeof makeSlot>

  beforeEach(() => {
    loader = makeLoader()
    slot = makeSlot()
  })

  it('10 个 URL：任一时刻在飞 ≤ 3，开始顺序 = 入队顺序', async () => {
    const queue = createPlanPrewarmQueue({
      loadImage: loader.loadImage,
      acquireSlot: slot.acquireSlot,
      hasLoaded: () => false,
      rememberLoaded: () => {},
    })
    queue.start()
    queue.enqueue(URLS)
    await flushMicrotasks()
    // 先放行 3 个
    expect(loader.started).toEqual(URLS.slice(0, 3))
    // 逐个完成，逐个递补
    for (const url of URLS) {
      loader.resolve(url)
      await flushMicrotasks()
    }
    expect(loader.started).toEqual(URLS)
    expect(loader.maxInflight()).toBeLessThanOrEqual(3)
  })

  it('重复 enqueue（同批/跨批）不重复加载', async () => {
    const queue = createPlanPrewarmQueue({
      loadImage: loader.loadImage,
      acquireSlot: slot.acquireSlot,
      hasLoaded: () => false,
      rememberLoaded: () => {},
    })
    queue.start()
    queue.enqueue(['/a', '/a', '/b'])
    queue.enqueue(['/a', '/b', '/c'])
    await flushMicrotasks()
    for (const url of [...loader.started]) {
      loader.resolve(url)
      await flushMicrotasks()
    }
    expect([...loader.started].sort()).toEqual(['/a', '/b', '/c'])
  })

  it('enqueue 时已加载的 URL 直接跳过', async () => {
    const queue = createPlanPrewarmQueue({
      loadImage: loader.loadImage,
      acquireSlot: slot.acquireSlot,
      hasLoaded: (url) => url === '/cached',
      rememberLoaded: () => {},
    })
    queue.start()
    queue.enqueue(['/cached', '/fresh'])
    await flushMicrotasks()
    expect(loader.started).toEqual(['/fresh'])
  })

  it('排队期间被其它路径加载的 URL 在轮到它时跳过', async () => {
    const loadedLater = new Set<string>()
    const queue = createPlanPrewarmQueue({
      loadImage: loader.loadImage,
      acquireSlot: slot.acquireSlot,
      hasLoaded: (url) => loadedLater.has(url),
      rememberLoaded: () => {},
    })
    queue.start()
    queue.enqueue(['/x', '/y', '/z', '/w'])
    await flushMicrotasks()
    expect(loader.started).toEqual(['/x', '/y', '/z'])
    // /w 排队期间被其它路径加载
    loadedLater.add('/w')
    loader.resolve('/x')
    await flushMicrotasks()
    expect(loader.started).toEqual(['/x', '/y', '/z'])
  })

  it('加载成功写入已加载缓存；失败不写入', async () => {
    const remembered: string[] = []
    const queue = createPlanPrewarmQueue({
      loadImage: loader.loadImage,
      acquireSlot: slot.acquireSlot,
      hasLoaded: () => false,
      rememberLoaded: (url) => remembered.push(url),
    })
    queue.start()
    queue.enqueue(['/ok', '/bad'])
    await flushMicrotasks()
    loader.resolve('/ok')
    loader.reject('/bad')
    await flushMicrotasks()
    expect(remembered).toEqual(['/ok'])
  })

  it('stop() 后未开始的不再加载', async () => {
    const queue = createPlanPrewarmQueue({
      loadImage: loader.loadImage,
      acquireSlot: slot.acquireSlot,
      hasLoaded: () => false,
      rememberLoaded: () => {},
    })
    queue.start()
    queue.enqueue(URLS.slice(0, 5))
    await flushMicrotasks()
    expect(loader.started).toHaveLength(3)
    queue.stop()
    for (const url of [...loader.started]) loader.resolve(url)
    await flushMicrotasks()
    // 未开始的 2 个不再加载
    expect(loader.started).toHaveLength(3)
  })

  it('H1：stop() 清空队列——start() + enqueue 新组后只加载新组，旧组不再出现', async () => {
    const queue = createPlanPrewarmQueue({
      loadImage: loader.loadImage,
      acquireSlot: slot.acquireSlot,
      hasLoaded: () => false,
      rememberLoaded: () => {},
    })
    queue.start()
    queue.enqueue(URLS)
    await flushMicrotasks()
    expect(loader.started).toEqual(URLS.slice(0, 3))
    // 加载 2 张，队列递补到第 5 张
    loader.resolve(URLS[0]!)
    loader.resolve(URLS[1]!)
    await flushMicrotasks()
    expect(loader.started).toEqual(URLS.slice(0, 5))
    expect(queue.snapshot().queued).toBe(5)

    queue.stop()
    // stop 清空尚未开始的排队项；在飞的照常完成
    expect(queue.snapshot().queued).toBe(0)
    queue.start()
    queue.enqueue(['/new-a', '/new-b'])
    await flushMicrotasks()
    for (const url of [...loader.started]) loader.resolve(url)
    await flushMicrotasks()
    // 旧组第 6–10 张不再出现；只有新组追加加载
    expect(loader.started).toEqual([...URLS.slice(0, 5), '/new-a', '/new-b'])
  })
})

describe('planPrewarmQueue（H2：挂起加载的超时与中止）', () => {
  /** 永不 settle 的 loadImage + 记录活跃 lease 数的槽位 */
  function makeHangingDeps() {
    const started: string[] = []
    let activeLeases = 0
    const loadImage = vi.fn((url: string) => {
      started.push(url)
      return new Promise<void>(() => {})
    })
    const acquireSlot = vi.fn(async () => {
      activeLeases += 1
      return {
        release: () => {
          activeLeases -= 1
        },
      }
    })
    return {
      started,
      loadImage,
      acquireSlot,
      activeLeases: () => activeLeases,
    }
  }

  afterEach(() => {
    vi.useRealTimers()
  })

  it('注入永不 settle 的 loadImage：15 秒超时后 lease 全部释放，队列继续推进', async () => {
    vi.useFakeTimers()
    const deps = makeHangingDeps()
    const queue = createPlanPrewarmQueue({
      loadImage: deps.loadImage,
      acquireSlot: deps.acquireSlot,
      hasLoaded: () => false,
      rememberLoaded: () => {},
    })
    queue.start()
    queue.enqueue(['/h1', '/h2', '/h3', '/h4'])
    await flushMicrotasks()
    expect(deps.started).toEqual(['/h1', '/h2', '/h3'])
    expect(deps.activeLeases()).toBe(3)

    await vi.advanceTimersByTimeAsync(PLAN_PREWARM_IMAGE_TIMEOUT_MS)
    await flushMicrotasks()
    // 前 3 张超时释放；/h4 递补进队继续推进
    expect(deps.started).toEqual(['/h1', '/h2', '/h3', '/h4'])
    expect(deps.activeLeases()).toBe(1)

    // /h4 也超时后 lease 归零
    await vi.advanceTimersByTimeAsync(PLAN_PREWARM_IMAGE_TIMEOUT_MS)
    await flushMicrotasks()
    expect(deps.activeLeases()).toBe(0)
  })

  it('stop() 后挂起的加载立即释放 lease', async () => {
    const deps = makeHangingDeps()
    const queue = createPlanPrewarmQueue({
      loadImage: deps.loadImage,
      acquireSlot: deps.acquireSlot,
      hasLoaded: () => false,
      rememberLoaded: () => {},
    })
    queue.start()
    queue.enqueue(['/s1', '/s2', '/s3'])
    await flushMicrotasks()
    expect(deps.activeLeases()).toBe(3)

    queue.stop()
    await flushMicrotasks()
    expect(deps.activeLeases()).toBe(0)
  })
})
