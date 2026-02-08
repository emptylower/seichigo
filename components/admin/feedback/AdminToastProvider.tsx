'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AdminToastContext, type AdminToast, type AdminToastApi, type AdminToastTone, type ShowAdminToastInput } from '@/hooks/useAdminToast'

const MAX_TOASTS = 3
const DEFAULT_DURATION_MS = 2500

function createToastId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function normalizeDuration(tone: AdminToastTone, durationMs: number | null | undefined): number | null {
  if (typeof durationMs === 'number') {
    if (!Number.isFinite(durationMs) || durationMs <= 0) return null
    return durationMs
  }
  if (durationMs === null) return null
  return tone === 'error' ? null : DEFAULT_DURATION_MS
}

export function AdminToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<AdminToast[]>([])
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  const clearTimer = useCallback((id: string) => {
    const timer = timersRef.current.get(id)
    if (!timer) return
    clearTimeout(timer)
    timersRef.current.delete(id)
  }, [])

  const dismiss = useCallback((id: string) => {
    clearTimer(id)
    setToasts((prev) => prev.filter((toast) => toast.id !== id))
  }, [clearTimer])

  const show = useCallback((input: ShowAdminToastInput) => {
    const tone: AdminToastTone = input.tone ?? 'info'
    const message = String(input.message || '').trim()
    if (!message) return ''

    const id = createToastId()
    const durationMs = normalizeDuration(tone, input.durationMs)
    const nextToast: AdminToast = {
      id,
      tone,
      title: input.title?.trim() || null,
      message,
      durationMs,
    }

    setToasts((prev) => {
      const merged = [...prev, nextToast]
      if (merged.length <= MAX_TOASTS) return merged
      const removed = merged.slice(0, merged.length - MAX_TOASTS)
      for (const toast of removed) {
        clearTimer(toast.id)
      }
      return merged.slice(-MAX_TOASTS)
    })

    if (durationMs != null) {
      const timer = setTimeout(() => {
        dismiss(id)
      }, durationMs)
      timersRef.current.set(id, timer)
    }

    return id
  }, [clearTimer, dismiss])

  const clear = useCallback(() => {
    for (const timer of timersRef.current.values()) {
      clearTimeout(timer)
    }
    timersRef.current.clear()
    setToasts([])
  }, [])

  useEffect(() => {
    return () => {
      for (const timer of timersRef.current.values()) {
        clearTimeout(timer)
      }
      timersRef.current.clear()
    }
  }, [])

  const api = useMemo<AdminToastApi>(() => ({
    toasts,
    show,
    success: (message: string, title = '操作成功') => show({ tone: 'success', title, message }),
    error: (message: string, title = '操作失败') => show({ tone: 'error', title, message }),
    info: (message: string, title = '提示') => show({ tone: 'info', title, message }),
    dismiss,
    clear,
  }), [clear, dismiss, show, toasts])

  return <AdminToastContext.Provider value={api}>{children}</AdminToastContext.Provider>
}
