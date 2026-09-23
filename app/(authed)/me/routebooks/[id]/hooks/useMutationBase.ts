'use client'

import { useCallback, useRef, type MutableRefObject } from 'react'
import type { RouteBookDetail } from '../types'
import { apiFetch, type ApiFail } from './tripDataApi'
import type { UndoEntry } from './useUndoRing'
import type { SupportedLocale } from '@/lib/i18n/types'

export type SetDetail = (
  value: RouteBookDetail | null | ((cur: RouteBookDetail | null) => RouteBookDetail | null)
) => void

export type MutationDeps = {
  id: string
  detailRef: MutableRefObject<RouteBookDetail | null>
  setDetail: SetDetail
  handleFailure: (result: ApiFail, prev: RouteBookDetail | null, fallback: string) => void
  pushUndo: (entry: UndoEntry) => void
  /** 级联删除（自定义点）后清空撤销环：环里可能躺着指向已删条目的记录 */
  clearUndo?: () => void
  /** 撤销环当前条数（决定是否 toast 提示「撤销历史已清空」） */
  getUndoCount?: () => number
  refreshPointPool: () => Promise<void>
  showToast: (message: string) => void
  load: () => Promise<void>
  locale?: SupportedLocale
}

/** 共享底座：locale 感知的 apiFetch + bookUpdatedAt 应用（所有写接口响应带顶层 bookUpdatedAt） */
export function useMutationBase({
  setDetail,
  locale = 'zh',
}: Pick<MutationDeps, 'setDetail' | 'locale'>) {
  const localeRef = useRef(locale)
  localeRef.current = locale
  const api = useCallback(
    <T,>(url: string, init?: RequestInit) => apiFetch<T>(url, init, localeRef.current),
    []
  )
  const applyBookUpdatedAt = useCallback(
    (value: unknown) => {
      if (typeof value !== 'string') return
      setDetail((cur) => (cur ? { ...cur, updatedAt: value } : cur))
    },
    [setDetail]
  )
  return { api, applyBookUpdatedAt, localeRef }
}

export function refreshPointPoolSilently(refreshPointPool: () => Promise<void>) {
  // 点位池同步已在服务端完成（加入即删）；本地仅做移除式刷新，失败静默
  void refreshPointPool().catch(() => undefined)
}
