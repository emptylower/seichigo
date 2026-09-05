'use client'

import { useEffect, useRef } from 'react'

/** 起始页交接第一条消息用的 sessionStorage 键（`/plan/start` 写、计划页取走） */
export const PENDING_DRAFT_KEY = 'planDraft:pending'
/** 超过这个年龄的草稿视为过期（用户中途走开又回来，不该被旧输入打扰） */
export const PENDING_DRAFT_MAX_AGE_MS = 10 * 60 * 1000

function parseCreatedAt(raw: unknown): number {
  if (typeof raw === 'number') return raw
  if (typeof raw === 'string') return Date.parse(raw)
  return Number.NaN
}

/**
 * 读取并删除待处理草稿：无论有效与否都删（只交接一次，刷新不会重放）。
 * sessionStorage 不可用（隐私模式）时静默当作没有草稿。
 */
export function takePendingDraft(now: number = Date.now()): string | null {
  let raw: string | null = null
  try {
    raw = window.sessionStorage.getItem(PENDING_DRAFT_KEY)
    window.sessionStorage.removeItem(PENDING_DRAFT_KEY)
  } catch {
    return null
  }
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw) as { text?: unknown; createdAt?: unknown }
    const text = typeof parsed.text === 'string' ? parsed.text.trim() : ''
    if (!text) return null
    const createdAt = parseCreatedAt(parsed.createdAt)
    if (!Number.isFinite(createdAt)) return null
    if (now - createdAt > PENDING_DRAFT_MAX_AGE_MS) return null
    return text
  } catch {
    return null
  }
}

/**
 * 计划页挂载时消费起始页交接过来的第一条消息：
 * 计划还没有任何消息 → 自动发送；已经有消息 → 只预填输入框，不打扰对话。
 *
 * 中-9：`onAutoSend` 返回「真的发出去了吗」。挂载这一刻上一轮还在跑（busy）时
 * 发不出去，此时**回退为预填**而不是把草稿扔掉——用户在起始页打的那段话不能
 * 因为一次时序不巧就人间蒸发。
 */
export function usePendingDraft(params: {
  hasMessages: boolean
  onAutoSend: (text: string) => boolean
  onPrefill: (text: string) => void
}): void {
  const paramsRef = useRef(params)
  paramsRef.current = params

  useEffect(() => {
    const text = takePendingDraft()
    if (!text) return
    const sent = paramsRef.current.hasMessages ? false : paramsRef.current.onAutoSend(text)
    if (!sent) paramsRef.current.onPrefill(text)
    // 只在挂载时消费一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
