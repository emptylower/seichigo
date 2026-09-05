'use client'

import { hasLoadedMapImage, rememberLoadedMapImage } from '@/components/map/utils/mapImageLoadedCache'
import { acquireMapImageRequestSlot } from '@/features/map/anitabi/mapImageRequestScheduler'

/**
 * 计划页图片预热队列（模块级单例）。
 * 语义：页面挂载即 start；days/daymap 变化只把新 URL 追加到队尾，
 * 不打断进行中与已排队的加载；仅组件卸载时 stop。
 * 并发上限 3：与 warmup 车道的总活跃门槛一致（交互态图片永远优先）。
 */

export const PLAN_PREWARM_QUEUE_CONCURRENCY = 3
/** 单张预热图的最长等待：超时/中止都要释放 lease，避免挂起的图拖死整个队列（H2） */
export const PLAN_PREWARM_IMAGE_TIMEOUT_MS = 15_000

export type PlanPrewarmQueueDeps = {
  loadImage?: (url: string, signal: AbortSignal) => Promise<void>
  acquireSlot?: (input: { signal: AbortSignal }) => Promise<{ release: () => void }>
  hasLoaded?: (url: string) => boolean
  rememberLoaded?: (url: string) => void
  maxConcurrent?: number
}

export type PlanPrewarmQueue = {
  enqueue: (urls: string[]) => void
  start: () => void
  stop: () => void
  snapshot: () => { queued: number; inflight: number; running: boolean }
}

function defaultLoadImage(url: string, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const image = new Image()
    const cleanup = () => {
      image.onload = null
      image.onerror = null
      // 取消在飞请求：置空 src 让浏览器停止拉取
      image.src = ''
    }
    const fail = (error: Error) => {
      cleanup()
      reject(error)
    }
    // 超时与 abort 任一触发都放弃这张图（H2：挂起的预热不许占住 lease）
    const timer = setTimeout(() => fail(new Error(`prewarm image timeout: ${url}`)), PLAN_PREWARM_IMAGE_TIMEOUT_MS)
    const settle = (action: () => void) => {
      clearTimeout(timer)
      action()
    }
    image.onload = () =>
      settle(() => {
        image.onload = null
        image.onerror = null
        resolve()
      })
    // 失败的图不写入缓存，由 ResilientMapImage 的候选梯/重试链正常兜底
    image.onerror = () => settle(() => fail(new Error(`prewarm image failed: ${url}`)))
    if (signal.aborted) {
      settle(() => fail(new Error('prewarm aborted')))
      return
    }
    signal.addEventListener('abort', () => settle(() => fail(new Error('prewarm aborted'))), { once: true })
    image.src = url
  })
}

export function createPlanPrewarmQueue(deps: PlanPrewarmQueueDeps = {}): PlanPrewarmQueue {
  const loadImage = deps.loadImage ?? defaultLoadImage
  const acquireSlot =
    deps.acquireSlot ?? ((input: { signal: AbortSignal }) => acquireMapImageRequestSlot({ lane: 'warmup', signal: input.signal }))
  const hasLoaded = deps.hasLoaded ?? hasLoadedMapImage
  const rememberLoaded = deps.rememberLoaded ?? rememberLoadedMapImage
  const maxConcurrent = Math.max(1, Math.floor(deps.maxConcurrent ?? PLAN_PREWARM_QUEUE_CONCURRENCY))

  const pending: string[] = []
  const queued = new Set<string>()
  const inflight = new Set<string>()
  let running = false
  let controller = new AbortController()

  function pump(): void {
    if (!running) return
    while (inflight.size < maxConcurrent && pending.length > 0) {
      const url = pending.shift()!
      queued.delete(url)
      // 排队期间被其它路径（如当前打开的那天）加载过 → 跳过
      if (hasLoaded(url)) continue
      inflight.add(url)
      void runOne(url)
    }
  }

  async function runOne(url: string): Promise<void> {
    const signal = controller.signal
    let lease: { release: () => void } | null = null
    try {
      lease = await acquireSlot({ signal })
    } catch {
      inflight.delete(url)
      pump()
      return
    }
    // 兜底守卫（H2）：注入/默认的 loadImage 都可能挂起——超时或 stop 中止
    // 任一触发都必须让 finally 释放 lease，队列才能继续推进
    let guardTimer: ReturnType<typeof setTimeout> | null = null
    let onAbort: (() => void) | null = null
    const guard = new Promise<never>((_, reject) => {
      onAbort = () => reject(new Error('prewarm aborted'))
      guardTimer = setTimeout(() => reject(new Error(`prewarm image timeout: ${url}`)), PLAN_PREWARM_IMAGE_TIMEOUT_MS)
      if (signal.aborted) onAbort()
      else signal.addEventListener('abort', onAbort, { once: true })
    })
    try {
      if (signal.aborted) return
      await Promise.race([loadImage(url, signal), guard])
      // 已发出的请求由浏览器自行完成：成功即写入已加载缓存（即使 stop 后也算数）
      rememberLoaded(url)
    } catch {
      // 失败/超时/中止不入缓存
    } finally {
      if (guardTimer != null) clearTimeout(guardTimer)
      if (onAbort) signal.removeEventListener('abort', onAbort)
      lease.release()
      inflight.delete(url)
      pump()
    }
  }

  return {
    enqueue(urls) {
      for (const raw of urls) {
        const url = String(raw ?? '').trim()
        if (!url) continue
        if (queued.has(url) || inflight.has(url) || hasLoaded(url)) continue
        queued.add(url)
        pending.push(url)
      }
      pump()
    },
    start() {
      if (running) return
      running = true
      if (controller.signal.aborted) controller = new AbortController()
      pump()
    },
    stop() {
      // H1：stop 同时清空尚未开始的排队项（在飞的照常 abort/完成），
      // 避免卸载/重开后旧一批 URL 又被翻出来加载
      pending.length = 0
      queued.clear()
      if (!running) return
      running = false
      controller.abort()
      controller = new AbortController()
    },
    snapshot() {
      return { queued: pending.length, inflight: inflight.size, running }
    },
  }
}

export const planPrewarmQueue = createPlanPrewarmQueue()
