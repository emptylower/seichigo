'use client'

import { useEffect, useMemo, useRef } from 'react'
import { getMapDisplayImageCandidates } from '@/lib/anitabi/imageProxy'
import type { TripPlanDayView } from '@/lib/tripPlan/view'
import { getMedia } from '../components/itemPayload'
import { planPrewarmQueue } from './planPrewarmQueue'

/** 单次预热收集的图片上限：避免超长行程一次性占满 warmup 低优先级车道 */
export const PLAN_PREWARM_MAX_IMAGES = 240

/** 预热只关心 chat 里的 daymap 快照（结构化兼容 ChatEntryView） */
export type PlanPrewarmChatEntry = {
  daymap?: { revisionId: string; days: TripPlanDayView[] } | null
}

/**
 * 收集行程所有天的可预热图片 URL（纯函数：不查已加载缓存——缓存在队列侧判，
 * 这样排队期间被其它路径加载的图也能跳过）：
 * - 非 transit 条目的 payload.media.displayUrl（同源相对路径原样保留）
 * - 站内点位 point.image 的 point-thumbnail 候选梯首档（h160 变体，与 DayCards 渲染口径一致）
 * 按首次出现顺序去重，最多 PLAN_PREWARM_MAX_IMAGES 张。
 */
export function collectPlanPrewarmUrls(days: TripPlanDayView[]): string[] {
  const urls: string[] = []
  const seen = new Set<string>()
  const push = (raw: string | null | undefined): void => {
    const url = String(raw ?? '').trim()
    if (!url || seen.has(url)) return
    if (urls.length >= PLAN_PREWARM_MAX_IMAGES) return
    seen.add(url)
    urls.push(url)
  }
  for (const day of days) {
    for (const item of day.items) {
      if (item.type === 'transit') continue
      push(getMedia(item)?.displayUrl)
      const pointImage = item.point?.image
      if (pointImage) push(getMapDisplayImageCandidates(pointImage, { kind: 'point-thumbnail' })[0])
      if (urls.length >= PLAN_PREWARM_MAX_IMAGES) return urls
    }
  }
  return urls
}

/**
 * agent 确定 daymap 后后台预热行程图片：页面挂载即开始（模块级单例队列，
 * 首屏 SSR days 直接可排），经 warmup 低优先级车道限流加载（同时最多 3 张
 * 在飞），成功写入 mapImageLoadedCache——切换到其它天/刷新后重开时
 * ResilientMapImage 命中已加载缓存（或浏览器本地缓存）直接渲染。
 * days/daymap 变化只把新 URL 追加到队尾，不打断进行中与已排队的；
 * 仅组件卸载时停止。
 */
export function usePlanImagePrewarm(days: TripPlanDayView[], chat: ReadonlyArray<PlanPrewarmChatEntry> = []): void {
  // 挂载期间队列常驻；仅卸载时停止（不随 props 变化重启）
  useEffect(() => {
    if (typeof Image === 'undefined') return
    planPrewarmQueue.start()
    return () => {
      planPrewarmQueue.stop()
    }
  }, [])

  // URL 集合签名：join 全文，保证 chat 文本消息等无关变化不会触发重排
  const { urls, signature } = useMemo(() => {
    const daymapDays = chat.flatMap((entry) => (entry.daymap ? entry.daymap.days : []))
    const collected = collectPlanPrewarmUrls([...days, ...daymapDays])
    return { urls: collected, signature: collected.join('\n') }
  }, [days, chat])

  // 签名变化时只把新 URL 追加到队尾（队列内部去重：在队/在飞/已加载的跳过）
  const lastEnqueuedSignatureRef = useRef('')
  useEffect(() => {
    if (typeof Image === 'undefined') return
    if (signature === lastEnqueuedSignatureRef.current) return
    lastEnqueuedSignatureRef.current = signature
    planPrewarmQueue.enqueue(urls)
  }, [signature, urls])
}
