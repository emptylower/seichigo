import { useEffect, useMemo, useRef, useState } from 'react'

type SaveState = 'idle' | 'saving' | 'saved' | 'error'
type FlushReason = 'debounce' | 'retry' | 'postflight'

interface UseTranslationAutoSaveParams {
  translationId: string
  draftContent: any
}

interface UseTranslationAutoSaveReturn {
  saveState: SaveState
  saveError: string | null
  triggerSave: () => void
}

export function useTranslationAutoSave({
  translationId,
  draftContent,
}: UseTranslationAutoSaveParams): UseTranslationAutoSaveReturn {
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)

  const payload = useMemo(() => {
    return JSON.stringify({ draftContent })
  }, [draftContent])

  const lastSaved = useRef<string>('')
  const pendingSave = useRef<string | null>(null)
  const saveInFlight = useRef(false)
  const lastChangeAt = useRef<number>(0)
  const debounceTimer = useRef<number | null>(null)
  const retryTimer = useRef<number | null>(null)
  const idleTimer = useRef<number | null>(null)
  const retryDelayMs = useRef<number>(0)
  const saveAbort = useRef<AbortController | null>(null)
  const mounted = useRef(true)

  function clearTimer(ref: { current: number | null }) {
    if (ref.current != null) {
      window.clearTimeout(ref.current)
      ref.current = null
    }
  }

  function scheduleRetry(nextDelayMs: number) {
    clearTimer(retryTimer)
    retryDelayMs.current = nextDelayMs
    retryTimer.current = window.setTimeout(() => {
      void flushSave('retry')
    }, nextDelayMs)
  }

  function extractErrorMessage(payload: any): string | null {
    if (!payload || typeof payload !== 'object') return null
    const raw = (payload as any).error
    if (typeof raw === 'string' && raw.trim()) return raw.trim()
    return null
  }

  function isRetryableStatus(status: number): boolean {
    // Retry on transient failures only.
    return status === 429 || status >= 500
  }

  async function flushSave(reason: FlushReason) {
    if (!translationId) return
    if (saveInFlight.current) return
    const snapshot = pendingSave.current
    if (!snapshot) return
    if (snapshot === lastSaved.current) return

    saveInFlight.current = true
    let succeeded = false
    let retryableFailure = false
    clearTimer(idleTimer)
    clearTimer(retryTimer)
    if (mounted.current) {
      setSaveState('saving')
      if (reason !== 'retry') setSaveError(null)
    }

    const controller = new AbortController()
    saveAbort.current = controller
    const timeout = window.setTimeout(() => controller.abort(), 15_000)
    try {
      const res = await fetch(`/api/admin/translations/${translationId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: snapshot,
        signal: controller.signal,
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        retryableFailure = isRetryableStatus(res.status)
        const msg = extractErrorMessage(data) || '保存失败'
        if (mounted.current) {
          setSaveError(msg)
          setSaveState('error')
        }

        if (retryableFailure && pendingSave.current && pendingSave.current !== lastSaved.current) {
          const base = retryDelayMs.current > 0 ? retryDelayMs.current : 2000
          const next = Math.min(30_000, Math.floor(base * 1.6))
          scheduleRetry(next)
        }
        return
      }

      lastSaved.current = snapshot
      retryDelayMs.current = 0
      succeeded = true

      const stillDirty = pendingSave.current != null && pendingSave.current !== lastSaved.current
      if (stillDirty) {
        if (mounted.current) setSaveState('saving')
      } else {
        pendingSave.current = null
        if (mounted.current) setSaveState('saved')
        clearTimer(idleTimer)
        idleTimer.current = window.setTimeout(() => {
          if (mounted.current) setSaveState('idle')
        }, 1200)
      }
    } catch (err: any) {
      const aborted = err?.name === 'AbortError'
      retryableFailure = true
      if (mounted.current) {
        setSaveError(aborted ? '保存超时，请稍后重试' : err?.message || '保存失败')
        setSaveState('error')
      }

      if (pendingSave.current && pendingSave.current !== lastSaved.current) {
        const base = retryDelayMs.current > 0 ? retryDelayMs.current : 2000
        const next = Math.min(30_000, Math.floor(base * 1.6))
        scheduleRetry(next)
      }
    } finally {
      window.clearTimeout(timeout)
      saveInFlight.current = false
      saveAbort.current = null

      // If user edited during an in-flight save, flush again after the remaining debounce window.
      if (succeeded && pendingSave.current && pendingSave.current !== lastSaved.current) {
        const elapsed = Date.now() - lastChangeAt.current
        const wait = Math.max(0, 800 - elapsed)
        clearTimer(debounceTimer)
        debounceTimer.current = window.setTimeout(() => {
          void flushSave('postflight')
        }, wait)
      }
    }
  }

  const triggerSave = () => {
    if (!translationId) return
    lastChangeAt.current = Date.now()
    pendingSave.current = payload
    clearTimer(debounceTimer)
    debounceTimer.current = window.setTimeout(() => {
      void flushSave('debounce')
    }, 800)
  }

  // Auto-trigger save when payload changes
  useEffect(() => {
    if (payload === lastSaved.current) return
    triggerSave()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload])

  // Cleanup on unmount
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      clearTimer(debounceTimer)
      clearTimer(retryTimer)
      clearTimer(idleTimer)
      if (saveAbort.current) {
        saveAbort.current.abort()
        saveAbort.current = null
      }
    }
  }, [])

  return {
    saveState,
    saveError,
    triggerSave,
  }
}
