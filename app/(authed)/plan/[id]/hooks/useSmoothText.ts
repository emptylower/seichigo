import { useEffect, useRef, useState } from 'react'

/** 到达间隔 EMA：初值对齐服务端 500ms 推送周期，钳制范围防止极端估计 */
const ARRIVAL_INIT_MS = 500
const ARRIVAL_MIN_MS = 250
const ARRIVAL_MAX_MS = 900
const EMA_ALPHA = 0.3
/** 每帧步进钳制：正常 [1, 12]；积压超 600 字（如刷新后一次拿到整段）放宽上限到 40 */
const STEP_MIN = 1
const STEP_MAX = 12
const BACKLOG_LEN = 600
const BACKLOG_STEP_MAX = 40

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function detectReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * 打字机播放缓冲：服务端每 500ms 推一帧全量 reasoning 快照，整串替换立刻渲染会变成
 * 「静止 500ms → 一次蹦出约 200 字」。本 hook 把渲染节奏与网络到达节奏解耦——
 * 用 rAF 逐帧把 renderedLen 推向 target.length，速率自适应：EMA 估计到达间隔
 * arrivalMs，每帧速率 charsPerMs = remaining / arrivalMs，即「用大约一个到达周期
 * 把当前缓冲放完」，既不提前放空干等，也不越积越多越落越远。
 *
 * - 前缀校验：服务端 reasoning 有 20000 字符「截头保尾」，新 target 可能不以已渲染
 *   前缀开头，此时直接 snap 到末尾并重置 EMA（不做 diff）。
 * - done=true：立刻 flush 到全长并停掉 rAF——run 结束后屏幕上绝不允许还有字在爬。
 * - prefers-reduced-motion: reduce：全程 snap，直接返回 target。
 * - opts.onFrame：本帧真的推进了字符时才回调（供调用方把自动滚动跟随放进同一 tick，
 *   避免空闲帧白做强制 layout）；空闲（remaining=0）时 rAF 循环整体停止，
 *   target 再次变长时由 effect 重新点火。
 */
export function useSmoothText(target: string, opts?: { done?: boolean; onFrame?: () => void }): string {
  const done = opts?.done === true
  const [renderedLen, setRenderedLen] = useState(0)
  const [reducedMotion] = useState(detectReducedMotion)
  const targetRef = useRef(target)
  const onFrameRef = useRef(opts?.onFrame)
  const stateRef = useRef({
    renderedLen: 0,
    arrivalMs: ARRIVAL_INIT_MS,
    lastArrivalAt: 0,
    lastTarget: '',
  })
  /** 挂起的 rAF id；0 = 循环已停（空闲/done/卸载），target 变长时重新点火 */
  const rafIdRef = useRef(0)
  const lastFrameAtRef = useRef(0)

  // tick 只读写 ref 与稳定的 setState，每次 render 重建闭包无副作用；
  // 循环靠自我预约延续（同一实例），ensureLoop 只在停止状态下点火（已挂帧时跳过）
  const tick = (now: number) => {
    const st = stateRef.current
    const t = targetRef.current
    const remaining = t.length - st.renderedLen
    if (remaining <= 0) {
      // 空闲：停掉循环——不再空转，也不再回调 onFrame
      rafIdRef.current = 0
      lastFrameAtRef.current = 0
      return
    }
    rafIdRef.current = requestAnimationFrame(tick)
    const dt = lastFrameAtRef.current > 0 ? now - lastFrameAtRef.current : 1000 / 60
    const charsPerMs = remaining / st.arrivalMs
    const stepMax = remaining > BACKLOG_LEN ? BACKLOG_STEP_MAX : STEP_MAX
    const step = clamp(Math.round(charsPerMs * dt), STEP_MIN, stepMax)
    const next = Math.min(t.length, st.renderedLen + step)
    lastFrameAtRef.current = now
    if (next !== st.renderedLen) {
      st.renderedLen = next
      setRenderedLen(next)
      // 只有本帧真的推进了字符才回调（onFrame 里通常是读 scrollHeight 的强制 layout）
      onFrameRef.current?.()
    }
  }

  const ensureLoop = () => {
    if (rafIdRef.current !== 0) return
    lastFrameAtRef.current = 0
    rafIdRef.current = requestAnimationFrame(tick)
  }

  // latest 镜像 + 前缀校验 + EMA 到达间隔估计（target 未变时除刷新回调引用外直接返回）
  useEffect(() => {
    targetRef.current = target
    onFrameRef.current = opts?.onFrame
    const st = stateRef.current
    // target 未变：前缀校验与 EMA 都只对「新快照」有意义，跳过 O(n) 切片与比较
    if (target === st.lastTarget) return
    const rendered = st.lastTarget.slice(0, st.renderedLen)
    if (!target.startsWith(rendered)) {
      // 截头保尾：已渲染前缀对不上 → 直接 snap 到末尾并重置 EMA
      st.renderedLen = target.length
      st.arrivalMs = ARRIVAL_INIT_MS
      st.lastArrivalAt = 0
      st.lastTarget = target
      setRenderedLen(target.length)
      return
    }
    if (target.length > st.lastTarget.length) {
      const now = Date.now()
      if (st.lastArrivalAt > 0) {
        const gap = now - st.lastArrivalAt
        st.arrivalMs = clamp(st.arrivalMs * (1 - EMA_ALPHA) + gap * EMA_ALPHA, ARRIVAL_MIN_MS, ARRIVAL_MAX_MS)
      }
      st.lastArrivalAt = now
      // 循环可能已空闲停止：重新点火（done / reduced-motion 下不起循环）
      if (!done && !reducedMotion) ensureLoop()
    }
    st.lastTarget = target
  })

  // done：立刻 flush 到全长（rAF loop 因 done 依赖退出，不再推进），并补一次跟随回调
  useEffect(() => {
    if (!done) return
    const st = stateRef.current
    if (st.renderedLen !== target.length) {
      st.renderedLen = target.length
      setRenderedLen(target.length)
    }
    onFrameRef.current?.()
  }, [done, target])

  // rAF 推进 loop：挂载/转回非 done 时点火，卸载/转 done 时 cancelAnimationFrame；
  // reduced-motion 直通不起循环
  useEffect(() => {
    if (done || reducedMotion) return
    ensureLoop()
    return () => {
      cancelAnimationFrame(rafIdRef.current)
      rafIdRef.current = 0
    }
  }, [done, reducedMotion])

  if (done || reducedMotion) return target
  return target.slice(0, renderedLen)
}
